export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid IC3 token format");
  }

  const payload = parts[1]
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");

  return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
}

export function decodeUserId(token: string): string {
  const payload = decodeJwtPayload(token);
  return String(payload.oid || payload.sub || "");
}

export function decodeDisplayName(token: string): string {
  const payload = decodeJwtPayload(token);
  return String(payload.name || payload.unique_name || payload.upn || "");
}

export function decodeExp(token: string): number {
  const payload = decodeJwtPayload(token);
  const exp = Number(payload.exp || 0);
  return Number.isFinite(exp) ? exp : 0;
}

export function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function parseDate(value?: string): Date {
  if (!value) return new Date(0);
  const normalized = value.endsWith("Z") ? value : value.replace("Z", "+00:00");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

export function detectChatType(convId: string, threadProps: Record<string, unknown>): string {
  const threadType = String(threadProps.threadType || "");
  if (threadType) return threadType;
  if (convId.includes("@unq.gbl.spaces")) return "oneOnOne";
  if (convId.includes("meeting_")) return "meeting";
  if (convId.includes("@thread")) return "group";
  return "unknown";
}

export function stripHtml(html: string): string {
  if (!html) return "";
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  if (seconds <= 0) return "expired";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (secs && parts.length < 2) parts.push(`${secs}s`);
  return parts.slice(0, 3).join(" ");
}

export function toIsoOrNull(expSeconds: number): string | null {
  if (!expSeconds) return null;
  return new Date(expSeconds * 1000).toISOString();
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function isProbablyConversationId(value: string): boolean {
  return value.startsWith("48:") || (value.includes(":") && (value.includes("@") || value.length > 50));
}

export function paragraphsToHtml(content: string): string {
  const parts = content
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part)}</p>`);
  return parts.join("") || "<p></p>";
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function looksLikeGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

export function makeClientMessageId(): string {
  const base = BigInt(Date.now()) * 1000n;
  const suffix = BigInt(Math.floor(Math.random() * 1000));
  return (base + suffix).toString();
}
