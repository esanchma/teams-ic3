import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import { CACHE_DIR, ID_MAP_FILE, TOKENS_FILE } from "./constants";
import type { CachedTokenBundle, IdMapFile, ListenerState } from "./types";
import { parseJson } from "./utils";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function ensureCacheDir(): Promise<void> {
  await ensureDir(CACHE_DIR);
}

export async function loadCachedTokens(): Promise<CachedTokenBundle | null> {
  try {
    const text = await readFile(TOKENS_FILE, "utf8");
    const parsed = parseJson<CachedTokenBundle | null>(text, null);
    if (!parsed?.ic3) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveCachedTokens(tokens: CachedTokenBundle): Promise<void> {
  await ensureCacheDir();
  const tempFile = `${TOKENS_FILE}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempFile, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(tempFile, TOKENS_FILE);
  } finally {
    await unlink(tempFile).catch(() => {});
  }
}

export async function loadIdMap(): Promise<IdMapFile> {
  try {
    const text = await readFile(ID_MAP_FILE, "utf8");
    const parsed = parseJson<IdMapFile | null>(text, null);
    return {
      chats: parsed?.chats || {},
      messages: parsed?.messages || {},
    };
  } catch {
    return { chats: {}, messages: {} };
  }
}

export async function saveIdMap(map: IdMapFile): Promise<void> {
  await ensureCacheDir();
  await writeFile(ID_MAP_FILE, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 });
}

export async function loadListenState(path: string): Promise<ListenerState | null> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = parseJson<ListenerState | null>(text, null);
    if (!parsed || parsed.version !== 1 || typeof parsed.startedAt !== "string") return null;
    return {
      version: 1,
      startedAt: parsed.startedAt,
      processed: parsed.processed || {},
    };
  } catch {
    return null;
  }
}

export async function saveListenState(path: string, state: ListenerState): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}
