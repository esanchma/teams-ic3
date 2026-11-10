import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const code = readFileSync(new URL("../webextension/background.js", import.meta.url), "utf8");

function jwt(audience: string, version = 1): string {
  const payload = Buffer.from(JSON.stringify({ aud: audience, version })).toString("base64url");
  return `header.${payload}.signature`;
}

function setup() {
  let listener: (details: object) => void = () => {};
  let time = 0;
  const messages: { host: string; data: { ic3: string }; reply: (response?: object) => void }[] = [];
  const logs: string[] = [];
  const runtime = {
    lastError: undefined as object | undefined,
    sendNativeMessage(host: string, data: { ic3: string }, reply: (response?: object) => void) {
      messages.push({ host, data, reply });
    },
  };
  runInNewContext(code, {
    atob,
    Date: { now: () => time },
    console: { info: (...args: string[]) => logs.push(args.join(" ")), warn: (...args: string[]) => logs.push(args.join(" ")) },
    chrome: { runtime, webRequest: { onBeforeSendHeaders: { addListener(callback: typeof listener) { listener = callback; } } } },
  });
  return {
    messages, logs, runtime,
    observe: (token: string) => listener({ requestHeaders: [{ name: "Authorization", value: `Bearer ${token}` }] }),
    advance: (ms: number) => { time += ms; },
  };
}

describe("Teams IC3 webextension", () => {
  test("sends IC3 tokens to the host once and never logs their value", () => {
    const app = setup();
    const token = jwt("https://ic3.teams.office.com");
    app.observe(jwt("https://example.com"));
    app.observe("not-a-jwt");
    app.observe(token);
    app.observe(token);
    expect(app.messages).toHaveLength(1);
    expect(app.messages[0].host).toBe("com.teams_ic3.host");
    expect(app.messages[0].data.ic3).toBe(token);
    app.messages[0].reply({ ok: true });
    app.observe(token);
    expect(app.messages).toHaveLength(1);
    expect(app.logs.join("\n")).not.toContain(token);
  });

  test("sends a newer token after the current request finishes", () => {
    const app = setup();
    const first = jwt("https://ic3.teams.office.com", 1);
    const second = jwt("https://ic3.teams.office.com", 2);
    app.observe(first);
    app.observe(second);
    expect(app.messages).toHaveLength(1);
    app.messages[0].reply({ ok: true });
    expect(app.messages).toHaveLength(2);
    expect(app.messages[1].data.ic3).toBe(second);
  });

  test("retries on a later request after a native host failure", () => {
    const app = setup();
    const token = jwt("https://ic3.teams.office.com");
    app.observe(token);
    app.runtime.lastError = {};
    app.messages[0].reply();
    app.runtime.lastError = undefined;
    app.observe(token);
    expect(app.messages).toHaveLength(1);
    app.advance(30_000);
    app.observe(token);
    expect(app.messages).toHaveLength(2);
    expect(app.logs.join("\n")).not.toContain(token);
  });
});
