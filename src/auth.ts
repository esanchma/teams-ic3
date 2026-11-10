import { existsSync } from "node:fs";
import { CHATSVC_BASE, DEFAULT_REGION, ID_MAP_FILE, TOKENS_FILE, USER_AGENT } from "./constants";
import { httpRequest } from "./http";
import { loadCachedTokens, saveCachedTokens } from "./store";
import type { AuthSource, AuthStatus, CachedTokenBundle, TokenBundle } from "./types";
import { decodeDisplayName, decodeExp, decodeUserId, formatDuration, nowSeconds, toIsoOrNull } from "./utils";

export async function getActiveTokenBundle(): Promise<{ source: AuthSource; bundle: TokenBundle | null }> {
  const cached = await loadCachedTokens();
  if (cached?.ic3) {
    return {
      source: "cache",
      bundle: {
        ic3: cached.ic3,
        region: cached.region || DEFAULT_REGION,
        userId: cached.user_id || decodeUserId(cached.ic3),
        displayName: cached.display_name || decodeDisplayName(cached.ic3),
        exp: cached.ic3_exp || decodeExp(cached.ic3),
      },
    };
  }

  return { source: "missing", bundle: null };
}

export function makeBundle(ic3: string, region: string): TokenBundle {
  return {
    ic3,
    region,
    userId: decodeUserId(ic3),
    displayName: decodeDisplayName(ic3),
    exp: decodeExp(ic3),
  };
}

export async function saveValidatedToken(ic3: string, region = DEFAULT_REGION): Promise<TokenBundle> {
  const bundle = makeBundle(ic3, region);
  const valid = await verifyToken(bundle);
  if (!valid) {
    throw new Error("Token validation failed");
  }

  const cached: CachedTokenBundle = {
    ic3: bundle.ic3,
    ic3_exp: bundle.exp,
    region: bundle.region,
    user_id: bundle.userId,
    display_name: bundle.displayName,
  };
  await saveCachedTokens(cached);
  return bundle;
}

export async function verifyToken(bundle: TokenBundle): Promise<boolean> {
  try {
    const response = await httpRequest(`${CHATSVC_BASE(bundle.region)}/users/ME/properties`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bundle.ic3}`,
        "User-Agent": USER_AGENT,
      },
      timeoutMs: 10000,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

export async function getAuthStatus(check = false): Promise<AuthStatus> {
  const { source, bundle } = await getActiveTokenBundle();
  const valid = check && bundle ? await verifyToken(bundle) : null;
  const exp = bundle?.exp || 0;
  const expiresIn = exp ? exp - nowSeconds() : null;

  return {
    ok: true,
    schema_version: "1.0",
    data: {
      auth_source: source,
      cache: {
        token_cache_exists: existsSync(TOKENS_FILE),
        token_cache_path: TOKENS_FILE,
        id_map_exists: existsSync(ID_MAP_FILE),
        id_map_path: ID_MAP_FILE,
      },
      identity: {
        region: bundle?.region || process.env.TEAMS_REGION || DEFAULT_REGION,
        user_id: bundle?.userId || "",
        display_name: bundle?.displayName || "",
      },
      tokens: {
        ic3: Boolean(bundle?.ic3),
      },
      ic3: {
        expires_at: exp ? toIsoOrNull(exp) : null,
        expires_in_seconds: expiresIn,
        expires_in_human: formatDuration(expiresIn),
        valid,
      },
    },
  };
}
