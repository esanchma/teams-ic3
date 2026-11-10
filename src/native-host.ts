import { endianness } from "node:os";
import type { Readable, Writable } from "node:stream";

import { saveValidatedToken } from "./auth";
import { DEFAULT_REGION } from "./constants";

const MAX_MESSAGE_BYTES = 64 * 1024;
const littleEndian = endianness() === "LE";

type TokenSaver = (ic3: string, region: string) => Promise<unknown>;

function frame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(4);
  if (littleEndian) header.writeUInt32LE(body.length);
  else header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

async function handleMessage(body: Buffer, saveToken: TokenSaver): Promise<object> {
  let message: unknown;
  try {
    message = JSON.parse(body.toString("utf8"));
  } catch {
    return { ok: false, error: "Invalid JSON message" };
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return { ok: false, error: "Expected an object with an ic3 token" };
  }
  const { ic3, region = DEFAULT_REGION } = message as Record<string, unknown>;
  if (typeof ic3 !== "string" || !ic3.trim() || typeof region !== "string" || !/^[a-z0-9-]+$/.test(region)) {
    return { ok: false, error: "Invalid token or region" };
  }
  try {
    await saveToken(ic3.trim(), region);
    return { ok: true };
  } catch {
    // Never include token data or network response bodies in the response.
    return { ok: false, error: "Token validation or storage failed" };
  }
}

export async function runNativeHost(input: Readable, output: Writable, saveToken: TokenSaver = saveValidatedToken): Promise<void> {
  let buffer = Buffer.alloc(0);
  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (buffer.length >= 4) {
      const length = littleEndian ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
      if (length > MAX_MESSAGE_BYTES) throw new Error("Native message exceeds size limit");
      if (buffer.length < length + 4) break;
      const body = buffer.subarray(4, length + 4);
      buffer = buffer.subarray(length + 4);
      const response = frame(await handleMessage(body, saveToken));
      await new Promise<void>((resolve, reject) => output.write(response, (error) => error ? reject(error) : resolve()));
    }
  }
  if (buffer.length) throw new Error("Incomplete native message");
}
