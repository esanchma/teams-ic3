import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_REGION = process.env.TEAMS_REGION || "emea";
export const CHATSVC_BASE = (region: string) => `https://teams.cloud.microsoft/api/chatsvc/${region}/v1`;
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const CACHE_DIR = process.env.TEAMS_IC3_CACHE_DIR || join(homedir(), ".cache", "teams-ic3");
export const TOKENS_FILE = join(CACHE_DIR, "tokens.json");
export const ID_MAP_FILE = join(CACHE_DIR, "id_map.json");
export const DEFAULT_LISTEN_STATE_FILE = join(CACHE_DIR, "listen_state.json");
export const DEFAULT_LISTEN_LOCK_FILE = join(CACHE_DIR, "listen.lock");
