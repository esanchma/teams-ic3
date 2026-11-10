import { open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

import { DEFAULT_LISTEN_LOCK_FILE, DEFAULT_LISTEN_STATE_FILE } from "./constants";
import type { ListenerState, ListenerStateEntry, MessageRecord } from "./types";
import { ensureCacheDir, ensureDir, loadListenState, saveListenState } from "./store";
import { parseDate } from "./utils";
import { TeamsIc3Client } from "./client";
import { CliError } from "./cli";

const MAX_PROCESSED_ENTRIES = 2000;

export interface ListenOptions {
  pollSeconds: number;
  trigger: string;
  chats: number;
  messages: number;
  stateFile: string;
  lockFile: string;
  once: boolean;
  piBin: string;
  piSession?: string;
  piCwd: string;
  piTimeoutSeconds: number;
  maxReplyChars: number;
  errorReplies: boolean;
  startupLookbackSeconds: number;
}

export async function listenLoop(client: TeamsIc3Client, options: ListenOptions): Promise<void> {
  await ensureCacheDir();
  const releaseLock = await acquireLock(options.lockFile);
  try {
    let state = await loadOrInitState(options.stateFile, options.startupLookbackSeconds);
    log(`listen started trigger=${options.trigger} poll=${options.pollSeconds}s cwd=${options.piCwd}`);

    do {
      const processed = await scanOnce(client, state, options);
      if (processed) {
        await pruneAndSaveState(options.stateFile, state);
      }
      if (options.once) break;
      await sleep(options.pollSeconds * 1000);
    } while (true);
  } finally {
    await releaseLock();
  }
}

async function scanOnce(client: TeamsIc3Client, state: ListenerState, options: ListenOptions): Promise<number> {
  const chats = [
    ...(await client.getChats({ top: options.chats, persistMap: false })),
    { id: "48:notes", title: "Notes" },
  ];
  const candidates: MessageRecord[] = [];

  for (const chat of chats) {
    try {
      const messages = await client.getChatMessages(chat.id, { top: options.messages, persistMap: false });
      for (const message of messages) {
        if (shouldProcessMessage(message, state, options.trigger)) {
          message.chatTitle = chat.title;
          candidates.push(message);
        }
      }
    } catch (error) {
      log(`warn chat=${chat.id} fetch_failed=${formatError(error)}`);
    }
  }

  candidates.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  let processedCount = 0;
  for (const message of candidates) {
    const key = makeProcessedKey(message.conversationId, message.id);
    const command = extractTriggerCommand(message.textContent, options.trigger);
    if (!command) continue;

    try {
      log(`processing chat=${message.conversationId} msg=${message.id} sender=${message.sender} command=${JSON.stringify(command)}`);
      const reply = truncateReply(await runPiForMessage(message, command, options), options.maxReplyChars);
      await client.replyToMessageRecord(message, reply || "(no response)");
      state.processed[key] = makeStateEntry(message, command, "ok", reply);
      processedCount += 1;
      log(`processed chat=${message.conversationId} msg=${message.id}`);
    } catch (error) {
      const errorText = formatError(error);
      state.processed[key] = makeStateEntry(message, command, "error", undefined, errorText);
      log(`error chat=${message.conversationId} msg=${message.id} error=${errorText}`);
      if (options.errorReplies) {
        try {
          await client.replyToMessageRecord(message, truncateReply(`Pi error: ${errorText}`, options.maxReplyChars));
        } catch (replyError) {
          log(`warn chat=${message.conversationId} msg=${message.id} error_reply_failed=${formatError(replyError)}`);
        }
      }
    }

    await pruneAndSaveState(options.stateFile, state);
  }

  return processedCount;
}

function shouldProcessMessage(message: MessageRecord, state: ListenerState, trigger: string): boolean {
  if (parseDate(message.timestamp).getTime() < parseDate(state.startedAt).getTime()) return false;
  if (state.processed[makeProcessedKey(message.conversationId, message.id)]) return false;
  return extractTriggerCommand(message.textContent, trigger) !== null;
}

export function extractTriggerCommand(text: string, trigger: string): string | null {
  const trimmed = (text || "").trim();
  const normalizedTrigger = trigger.trim();
  if (!trimmed || !normalizedTrigger) return null;

  const lowerText = trimmed.toLowerCase();
  const lowerTrigger = normalizedTrigger.toLowerCase();
  if (!lowerText.startsWith(lowerTrigger)) return null;

  const nextChar = trimmed.slice(normalizedTrigger.length, normalizedTrigger.length + 1);
  if (nextChar && !/\s|:|,/.test(nextChar)) return null;

  const command = trimmed.slice(normalizedTrigger.length).replace(/^[\s:,.-]+/, "").trim();
  return command || null;
}

export function truncateReply(text: string, maxChars: number): string {
  if (!maxChars || maxChars < 0 || text.length <= maxChars) return text;
  if (maxChars < 40) return text.slice(0, maxChars);
  const marker = "\n\n[truncated by teams-ic3 listen]";
  return `${text.slice(0, Math.max(0, maxChars - marker.length)).trimEnd()}${marker}`;
}

function makeProcessedKey(conversationId: string, messageId: string): string {
  return `${conversationId}::${messageId}`;
}

function makeStateEntry(
  message: MessageRecord,
  command: string,
  status: ListenerStateEntry["status"],
  responsePreview?: string,
  error?: string,
): ListenerStateEntry {
  return {
    conversationId: message.conversationId,
    messageId: message.id,
    processedAt: new Date().toISOString(),
    status,
    sender: message.sender,
    command,
    responsePreview: responsePreview?.slice(0, 200),
    error,
  };
}

async function runPiForMessage(message: MessageRecord, command: string, options: ListenOptions): Promise<string> {
  const args = ["-p"];
  if (options.piSession) args.push("--session", options.piSession);
  else args.push("--no-session");

  const prompt = buildPiPrompt(message, command);
  args.push(prompt);

  return new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(options.piBin, args, {
      cwd: options.piCwd,
      env: {
        ...process.env,
        PI_SKIP_VERSION_CHECK: "1",
        PI_TELEMETRY: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, options.piTimeoutSeconds * 1000);

    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (signal) {
        rejectPromise(new Error(`pi terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        rejectPromise(new Error(stderr || `pi exited with code ${code}`));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

function buildPiPrompt(message: MessageRecord, command: string): string {
  const chatTitle = message.chatTitle ? `\n- Chat title: ${message.chatTitle}` : "";
  return [
    "You are handling a single Microsoft Teams request detected by an external deterministic listener.",
    "",
    "Important rules:",
    "- The wrapper will send the final reply back to Teams. Do not send any Teams message yourself.",
    "- Use the local teams-ic3 skill or shell commands if you need to inspect the Teams conversation context.",
    "- Prefer reading the relevant chat context before answering if context matters.",
    "- Reply only to the request below.",
    "- Output only the final user-facing reply text. No preamble, no explanation of your internal process.",
    "",
    "Trigger event:",
    `- Conversation ID: ${message.conversationId}`,
    `- Message ID: ${message.id}`,
    `- Sender: ${message.sender}`,
    `- Timestamp: ${message.timestamp}`,
    `${chatTitle}`,
    `- Raw trigger message: ${JSON.stringify(message.textContent)}`,
    `- Extracted command: ${JSON.stringify(command)}`,
    "",
    "If you need Teams context, inspect the conversation using the conversation id above.",
    "If the request is unrelated to Teams and instead asks for coding or shell work, do that work in the current working directory.",
    "Return just the final answer text that should be posted back to the same Teams thread.",
  ].join("\n");
}

async function loadOrInitState(path: string, startupLookbackSeconds: number): Promise<ListenerState> {
  const existing = await loadListenState(path);
  if (existing) return existing;

  const state: ListenerState = {
    version: 1,
    startedAt: new Date(Date.now() - startupLookbackSeconds * 1000).toISOString(),
    processed: {},
  };
  await saveListenState(path, state);
  return state;
}

async function pruneAndSaveState(path: string, state: ListenerState): Promise<void> {
  const entries = Object.entries(state.processed);
  if (entries.length > MAX_PROCESSED_ENTRIES) {
    entries.sort((a, b) => Date.parse(a[1].processedAt) - Date.parse(b[1].processedAt));
    state.processed = Object.fromEntries(entries.slice(-MAX_PROCESSED_ENTRIES));
  }
  await saveListenState(path, state);
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  await ensureCacheDir();
  const resolved = resolve(lockPath || DEFAULT_LISTEN_LOCK_FILE);
  await ensureDir(dirname(resolved));

  const file = await open(resolved, "wx").catch((error: NodeJS.ErrnoException) => {
    if (error?.code === "EEXIST") {
      throw new CliError(`Listen lock already exists at ${resolved}. Is another teams-ic3 listen running?`);
    }
    throw error;
  });

  await file.writeFile(`${process.pid}\n`);

  let released = false;
  const cleanup = async () => {
    if (released) return;
    released = true;
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("exit", onExit);
    await file.close().catch(() => undefined);
    await unlink(resolved).catch(() => undefined);
  };

  const onSignal = () => {
    cleanup().finally(() => process.exit(0));
  };
  const onExit = () => {
    if (!released) {
      released = true;
      void file.close().catch(() => undefined);
      void unlink(resolved).catch(() => undefined);
    }
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("exit", onExit);

  return cleanup;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function log(message: string): void {
  process.stderr.write(`[teams-ic3 listen] ${new Date().toISOString()} ${message}\n`);
}

export function defaultListenOptions(): ListenOptions {
  return {
    pollSeconds: 180,
    trigger: "@pi",
    chats: 20,
    messages: 12,
    stateFile: DEFAULT_LISTEN_STATE_FILE,
    lockFile: DEFAULT_LISTEN_LOCK_FILE,
    once: false,
    piBin: "pi",
    piCwd: process.cwd(),
    piTimeoutSeconds: 600,
    maxReplyChars: 4000,
    errorReplies: true,
    startupLookbackSeconds: 0,
  };
}
