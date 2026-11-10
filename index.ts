#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr, exit } from "node:process";

import { getActiveTokenBundle, getAuthStatus } from "./src/auth";
import { TeamsIc3Client, ApiError } from "./src/client";
import { AuthError, CliError, UsageError, parseArgs, requireNumber } from "./src/cli";
import { defaultListenOptions, listenLoop } from "./src/listen";
import { installNativeHost } from "./src/install";
import { runNativeHost } from "./src/native-host";

function usage(): string {
  return `teams-ic3 - IC3-only Microsoft Teams CLI

Usage:
  teams-ic3 help
  teams-ic3 install <edge-extension-id>
  teams-ic3 auth-status [--check] [--json]
  teams-ic3 whoami [--json]
  teams-ic3 summary [--json]
  teams-ic3 chats [-n N|--max N] [--offset N] [--unread] [--json]
  teams-ic3 chat <chat-num-or-id> [-n N|--max N] [--offset N] [--json]
  teams-ic3 read <message-num> [--json]
  teams-ic3 search <query> [-n N|--max N] [--offset N] [--chat CHAT] [--json]
  teams-ic3 user-search <query> [--json]
  teams-ic3 chat-send <chat-num-or-id> [<message...>] [--stdin] [--json]
  teams-ic3 send <user-query> [<message...>] [--stdin] [--json]
  teams-ic3 reply <message-num> [<message...>] [--stdin] [--json]
  teams-ic3 edit <message-num> [<new-text...>] [--stdin] [--json]
  teams-ic3 delete <message-num> [--yes] [--json]
  teams-ic3 listen [--poll-seconds N] [--trigger @pi] [--chats N] [--messages N] [--state-file PATH] [--lock-file PATH] [--pi-bin PATH] [--pi-session PATH|ID] [--pi-cwd PATH] [--pi-timeout-seconds N] [--max-reply-chars N] [--startup-lookback-seconds N] [--once]

Auth:
  - Uses the IC3 token stored by the Edge native messaging host
  - Run without arguments to start the native messaging host

Notes:
  - No Graph, no Playwright, no browser login
  - user-search/send are IC3-only best effort from known chats and recent messages
  - Chat/message numbers come from the local id map, populated by 'chats', 'chat' and 'search'
  - delete requires confirmation unless you pass --yes
  - listen is a deterministic Teams poller that invokes pi in oneshot mode and posts the response back to the triggering chat
`;
}

function printJson(value: unknown) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readMessageArg(messageParts: string[], useStdinFlag = false): Promise<string> {
  let message = useStdinFlag ? "" : messageParts.join(" ").trim();

  if (!message && (useStdinFlag || !stdin.isTTY)) {
    message = (await readStdin()).trim();
  }

  if (!message) {
    throw new UsageError("No message provided. Pass text arguments or use --stdin.");
  }

  return message;
}

async function promptYesNo(prompt: string): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new UsageError("Refusing to prompt for confirmation on non-interactive stdin. Pass --yes to proceed.");
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function confirmDelete(client: TeamsIc3Client, msgRef: string, force = false): Promise<void> {
  if (force) return;

  const message = await client.getMessageDetail(msgRef);
  const preview = (message.textContent || "").replace(/\s+/g, " ").trim();
  const suffix = preview ? `: ${preview.slice(0, 80)}` : "";
  const confirmed = await promptYesNo(`Delete message #${msgRef}${suffix}? [y/N] `);
  if (!confirmed) {
    throw new CliError("Delete cancelled.", 0);
  }
}

async function getClient(): Promise<TeamsIc3Client> {
  const { bundle } = await getActiveTokenBundle();
  if (!bundle) {
    throw new AuthError("No IC3 token found. Set up the Edge extension and native host.");
  }
  return new TeamsIc3Client(bundle);
}

function formatChatLine(chat: any): string {
  const unread = chat.unreadCount ? ` unread=${chat.unreadCount}` : "";
  return `${String(chat.displayNum).padStart(2, " ")}. ${chat.title}${unread}\n    ${chat.lastMessageSender}: ${chat.lastMessagePreview}`;
}

function formatMessageLine(message: any): string {
  const sender = message.sender || "Unknown";
  const text = message.textContent || "";
  const chat = message.chatTitle ? ` [${message.chatTitle}]` : "";
  return `${String(message.displayNum).padStart(2, " ")}. ${sender}${chat}: ${text}`;
}

function ok(data: unknown) {
  return { ok: true, schema_version: "1.0", data };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  // Edge supplies the extension origin as the first argument to a native host.
  if (!command || (/^chrome-extension:\/\/[a-p]{32}\/?$/.test(command) && rest.length === 0)) {
    await runNativeHost(stdin, stdout);
    return;
  }
  const args = parseArgs(rest);
  const asJson = args.flags.has("json");
  const useStdinFlag = args.flags.has("stdin");

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      stdout.write(usage());
      return;

    case "install": {
      if (!Bun.main.startsWith("/$bunfs/")) {
        throw new UsageError("Build the native binary before running install.");
      }
      if (args.positionals.length !== 1) {
        throw new UsageError("Usage: teams-ic3 install <edge-extension-id>");
      }
      const manifestPath = await installNativeHost(args.positionals[0], process.execPath);
      if (asJson) printJson(ok({ manifest_path: manifestPath }));
      else stdout.write(`Native host installed: ${manifestPath}\n`);
      return;
    }

    case "auth-status": {
      const status = await getAuthStatus(args.flags.has("check"));
      if (asJson) printJson(status);
      else {
        stdout.write(`source=${status.data.auth_source}\n`);
        stdout.write(`region=${status.data.identity.region}\n`);
        stdout.write(`user=${status.data.identity.display_name || "N/A"}\n`);
        stdout.write(`cache=${status.data.cache.token_cache_exists ? "yes" : "no"}\n`);
        stdout.write(`id_map=${status.data.cache.id_map_exists ? "yes" : "no"}\n`);
        stdout.write(`ic3=${status.data.tokens.ic3 ? "present" : "missing"}\n`);
        if (status.data.ic3.expires_at) stdout.write(`expires_at=${status.data.ic3.expires_at}\n`);
        if (status.data.ic3.expires_in_human) stdout.write(`expires_in=${status.data.ic3.expires_in_human}\n`);
        if (args.flags.has("check")) stdout.write(`valid=${String(status.data.ic3.valid)}\n`);
      }
      return;
    }

    case "whoami": {
      const { bundle } = await getActiveTokenBundle();
      if (!bundle) throw new AuthError("No IC3 token found.");
      const data = ok({ displayName: bundle.displayName, user_id: bundle.userId, region: bundle.region });
      if (asJson) printJson(data);
      else stdout.write(`${bundle.displayName} (${bundle.userId}) [${bundle.region}]\n`);
      return;
    }

    case "summary": {
      const client = await getClient();
      const recent = await client.getChats({ top: 5 });
      const unread = await client.getChats({ top: 200, unreadOnly: true, persistMap: false });
      const data = ok({
        unread_count: unread.length,
        unread_messages: unread.reduce((sum, chat) => sum + chat.unreadCount, 0),
        recent,
      });
      if (asJson) printJson(data);
      else {
        stdout.write(`unread_chats=${data.data.unread_count}\n`);
        stdout.write(`unread_messages=${data.data.unread_messages}\n`);
        for (const chat of recent) stdout.write(`${formatChatLine(chat)}\n`);
      }
      return;
    }

    case "chats": {
      const client = await getClient();
      const chats = await client.getChats({
        top: requireNumber(args.values.get("max"), 25),
        skip: requireNumber(args.values.get("offset"), 0),
        unreadOnly: args.flags.has("unread"),
      });
      const data = ok(chats);
      if (asJson) printJson(data);
      else for (const chat of chats) stdout.write(`${formatChatLine(chat)}\n`);
      return;
    }

    case "chat": {
      const [chatRef] = args.positionals;
      if (!chatRef) throw new UsageError("Usage: teams-ic3 chat <chat-num-or-id>");
      const client = await getClient();
      const messages = await client.getChatMessages(chatRef, {
        top: requireNumber(args.values.get("max"), 25),
        skip: requireNumber(args.values.get("offset"), 0),
      });
      const data = ok(messages);
      if (asJson) printJson(data);
      else for (const message of messages) stdout.write(`${formatMessageLine(message)}\n`);
      return;
    }

    case "read": {
      const [msgRef] = args.positionals;
      if (!msgRef) throw new UsageError("Usage: teams-ic3 read <message-num>");
      const client = await getClient();
      const message = await client.getMessageDetail(msgRef);
      const data = ok(message);
      if (asJson) printJson(data);
      else {
        stdout.write(`#${message.displayNum} ${message.sender} ${message.timestamp}\n`);
        if (message.chatTitle) stdout.write(`[${message.chatTitle}]\n`);
        stdout.write(`${message.textContent}\n`);
      }
      return;
    }

    case "search": {
      const query = args.positionals.join(" ").trim();
      if (!query) throw new UsageError("Usage: teams-ic3 search <query>");
      const client = await getClient();
      const messages = await client.searchMessages(query, {
        top: requireNumber(args.values.get("max"), 25),
        offset: requireNumber(args.values.get("offset"), 0),
        chatRef: args.values.get("chat"),
      });
      const data = ok(messages);
      if (asJson) printJson(data);
      else for (const message of messages) stdout.write(`${formatMessageLine(message)}\n`);
      return;
    }

    case "user-search": {
      const query = args.positionals.join(" ").trim();
      if (!query) throw new UsageError("Usage: teams-ic3 user-search <query>");
      const client = await getClient();
      const users = await client.searchUsers(query);
      const data = ok(users);
      if (asJson) printJson(data);
      else for (const user of users) stdout.write(`${user.displayName} (${user.id})\n`);
      return;
    }

    case "chat-send": {
      const [chatRef, ...messageParts] = args.positionals;
      if (!chatRef) throw new UsageError("Usage: teams-ic3 chat-send <chat-num-or-id> [<message...>] [--stdin]");
      const client = await getClient();
      const response = await client.sendMessage(chatRef, await readMessageArg(messageParts, useStdinFlag), false);
      const data = ok(response);
      if (asJson) printJson(data);
      else stdout.write(`Message sent to ${chatRef}\n`);
      return;
    }

    case "send": {
      const [userQuery, ...messageParts] = args.positionals;
      if (!userQuery) throw new UsageError("Usage: teams-ic3 send <user-query> [<message...>] [--stdin]");
      const client = await getClient();
      const response = await client.sendMessageToUser(userQuery, await readMessageArg(messageParts, useStdinFlag));
      const data = ok(response);
      if (asJson) printJson(data);
      else stdout.write(`Message sent to ${userQuery}\n`);
      return;
    }

    case "reply": {
      const [msgRef, ...messageParts] = args.positionals;
      if (!msgRef) throw new UsageError("Usage: teams-ic3 reply <message-num> [<message...>] [--stdin]");
      const client = await getClient();
      const response = await client.replyToMessage(msgRef, await readMessageArg(messageParts, useStdinFlag));
      const data = ok(response);
      if (asJson) printJson(data);
      else stdout.write(`Reply sent to #${msgRef}\n`);
      return;
    }

    case "edit": {
      const [msgRef, ...messageParts] = args.positionals;
      if (!msgRef) throw new UsageError("Usage: teams-ic3 edit <message-num> [<new-text...>] [--stdin]");
      const client = await getClient();
      const response = await client.editMessage(msgRef, await readMessageArg(messageParts, useStdinFlag));
      const data = ok(response);
      if (asJson) printJson(data);
      else stdout.write(`Message #${msgRef} edited\n`);
      return;
    }

    case "delete": {
      const [msgRef] = args.positionals;
      if (!msgRef) throw new UsageError("Usage: teams-ic3 delete <message-num> [--yes]");
      const client = await getClient();
      await confirmDelete(client, msgRef, args.flags.has("yes"));
      const response = await client.deleteMessage(msgRef);
      const data = ok(response);
      if (asJson) printJson(data);
      else stdout.write(`Message #${msgRef} deleted\n`);
      return;
    }

    case "listen": {
      const client = await getClient();
      const defaults = defaultListenOptions();
      await listenLoop(client, {
        pollSeconds: requireNumber(args.values.get("poll-seconds"), defaults.pollSeconds),
        trigger: args.values.get("trigger") || defaults.trigger,
        chats: requireNumber(args.values.get("chats"), defaults.chats),
        messages: requireNumber(args.values.get("messages"), defaults.messages),
        stateFile: args.values.get("state-file") || defaults.stateFile,
        lockFile: args.values.get("lock-file") || defaults.lockFile,
        once: args.flags.has("once"),
        piBin: args.values.get("pi-bin") || defaults.piBin,
        piSession: args.values.get("pi-session") || undefined,
        piCwd: args.values.get("pi-cwd") || defaults.piCwd,
        piTimeoutSeconds: requireNumber(args.values.get("pi-timeout-seconds"), defaults.piTimeoutSeconds),
        maxReplyChars: requireNumber(args.values.get("max-reply-chars"), defaults.maxReplyChars),
        errorReplies: !args.flags.has("no-error-replies"),
        startupLookbackSeconds: requireNumber(args.values.get("startup-lookback-seconds"), defaults.startupLookbackSeconds),
      });
      return;
    }

    default:
      throw new UsageError(`Unknown command: ${command}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof ApiError) {
    stderr.write(`${error.message}${error.body ? `\n${error.body}` : ""}\n`);
    exit(error.statusCode === 401 ? 4 : 1);
  }
  if (error instanceof CliError) {
    if (error.message) stderr.write(`${error.message}\n`);
    exit(error.exitCode);
  }
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  exit(1);
});
