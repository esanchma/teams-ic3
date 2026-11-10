import { describe, expect, test } from "bun:test";
import { endianness } from "node:os";
import { Readable, Writable } from "node:stream";

import { runNativeHost } from "../src/native-host";
import { DEFAULT_REGION } from "../src/constants";

function encode(text: string): Buffer {
  const body = Buffer.from(text);
  const header = Buffer.alloc(4);
  if (endianness() === "LE") header.writeUInt32LE(body.length);
  else header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

function decode(buffer: Buffer): unknown[] {
  const messages: unknown[] = [];
  while (buffer.length) {
    const size = endianness() === "LE" ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
    messages.push(JSON.parse(buffer.subarray(4, size + 4).toString()));
    buffer = buffer.subarray(size + 4);
  }
  return messages;
}

function outputBuffer() {
  const chunks: Buffer[] = [];
  const output = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  return { output, result: () => decode(Buffer.concat(chunks)) };
}

describe("native messaging host", () => {
  test("handles split and multiple messages sequentially without returning tokens", async () => {
    const bytes = Buffer.concat([encode('{"ic3":"secret","region":"emea"}'), encode('{"ic3":"second"}')]);
    const received: string[] = [];
    const { output, result } = outputBuffer();
    await runNativeHost(Readable.from([bytes.subarray(0, 2), bytes.subarray(2, 11), bytes.subarray(11)]), output, async (token, region) => {
      received.push(`${token}:${region}`);
    });
    expect(received).toEqual(["secret:emea", `second:${DEFAULT_REGION}`]);
    expect(result()).toEqual([{ ok: true }, { ok: true }]);
  });

  test("rejects malformed messages and hides validation errors", async () => {
    const input = Buffer.concat([encode("{"), encode('{"ic3":"secret","region":"../other"}'), encode('{"ic3":"secret"}')]);
    const { output, result } = outputBuffer();
    await runNativeHost(Readable.from([input]), output, async () => { throw new Error("secret"); });
    expect(result()).toEqual([
      { ok: false, error: "Invalid JSON message" },
      { ok: false, error: "Invalid token or region" },
      { ok: false, error: "Token validation or storage failed" },
    ]);
  });

  test("rejects truncated and oversized frames", async () => {
    const { output } = outputBuffer();
    await expect(runNativeHost(Readable.from([encode("{}").subarray(0, 5)]), output)).rejects.toThrow("Incomplete");
    const header = Buffer.alloc(4);
    if (endianness() === "LE") header.writeUInt32LE(65537);
    else header.writeUInt32BE(65537);
    await expect(runNativeHost(Readable.from([header]), output)).rejects.toThrow("size limit");
  });
});
