import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { resolve } from "node:path";

const cert = resolve(import.meta.dir, "fixtures/localhost-cert.pem");
const key = resolve(import.meta.dir, "fixtures/localhost-key.pem");
let target: ReturnType<typeof Bun.serve>;
let proxy: Server;
let proxyUrl: string;
let connects: { url: string | undefined; authorization: string | undefined }[] = [];

async function request(env: Record<string, string>, options: object = {}) {
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(https?_proxy|all_proxy|no_proxy)$/i.test(name)));
  const child = Bun.spawn([process.execPath, "-e", `
    import { httpRequest } from ${JSON.stringify(resolve(import.meta.dir, "../src/http.ts"))};
    try {
      console.log(JSON.stringify(await httpRequest(process.env.TEST_URL, ${JSON.stringify(options)})));
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  `], {
    env: { ...cleanEnv, NODE_EXTRA_CA_CERTS: cert, TEST_URL: `https://127.0.0.1:${target.port}/test`, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(stderr);
  return JSON.parse(stdout);
}

beforeAll(async () => {
  target = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: { cert: Bun.file(cert), key: Bun.file(key) },
    async fetch(req) {
      if (new URL(req.url).pathname === "/redirect") return new Response(null, { status: 302, headers: { location: "/test" } });
      if (new URL(req.url).pathname === "/unauthorized") return new Response("unauthorized", { status: 401 });
      if (new URL(req.url).pathname === "/slow") await Bun.sleep(200);
      return Response.json({ method: req.method, authorization: req.headers.get("authorization"), proxyAuthorization: req.headers.get("proxy-authorization"), body: await req.text() }, { status: 201, headers: { "x-test": "yes" } });
    },
  });
  proxy = createServer();
  proxy.on("connect", (req, client, head) => {
    connects.push({ url: req.url, authorization: req.headers["proxy-authorization"] });
    const upstream = connect(target.port!, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  proxyUrl = `http://user:password@127.0.0.1:${(proxy.address() as { port: number }).port}`;
});

afterAll(() => {
  target.stop(true);
  proxy.close();
});

describe("HTTP transport", () => {
  test("sends HTTPS requests through HTTPS_PROXY without leaking proxy credentials", async () => {
    connects = [];
    const result = await request({ HTTPS_PROXY: proxyUrl }, { method: "POST", headers: { Authorization: "Bearer token" }, body: "hello" });
    expect(connects).toEqual([{ url: `127.0.0.1:${target.port}`, authorization: `Basic ${Buffer.from("user:password").toString("base64")}` }]);
    expect(result.status).toBe(201);
    expect(result.headers["x-test"]).toBe("yes");
    expect(JSON.parse(result.body)).toEqual({ method: "POST", authorization: "Bearer token", proxyAuthorization: null, body: "hello" });
  });

  test("honors lowercase proxy variables and NO_PROXY", async () => {
    connects = [];
    await request({ https_proxy: proxyUrl, no_proxy: "127.0.0.1" });
    expect(connects).toEqual([]);
    await request({ https_proxy: proxyUrl, no_proxy: "example.com" });
    expect(connects).toHaveLength(1);
  });

  test("uses ALL_PROXY as a fallback for HTTPS", async () => {
    connects = [];
    await request({ ALL_PROXY: proxyUrl });
    expect(connects).toHaveLength(1);
  });

  test("fails rather than connecting directly if the proxy is unavailable", async () => {
    await expect(request({ HTTPS_PROXY: "http://127.0.0.1:1" })).rejects.toThrow();
  });

  test("enforces the request timeout", async () => {
    await expect(request({ TEST_URL: `https://127.0.0.1:${target.port}/slow` }, { timeoutMs: 30 })).rejects.toThrow();
  });

  test("verifies TLS certificates and preserves error responses", async () => {
    await expect(request({ NODE_EXTRA_CA_CERTS: "" })).rejects.toThrow();
    const result = await request({ TEST_URL: `https://127.0.0.1:${target.port}/unauthorized` });
    expect(result.status).toBe(401);
    expect(result.body).toBe("unauthorized");
  });

  test("connects directly without a proxy and does not follow redirects", async () => {
    connects = [];
    const result = await request({ TEST_URL: `https://127.0.0.1:${target.port}/redirect` });
    expect(result.status).toBe(302);
    expect(result.headers.location).toBe("/test");
    expect(connects).toEqual([]);
  });
});
