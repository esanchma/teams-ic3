import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installNativeHost, NATIVE_HOST_NAME } from "../src/install";

describe("Edge native host installer", () => {
  test("installs a manifest restricted to the requested extension", async () => {
    const config = await mkdtemp(join(tmpdir(), "teams-ic3-install-test-"));
    try {
      const extensionId = "a".repeat(32);
      const path = await installNativeHost(extensionId, process.execPath, config);
      expect(path).toBe(join(config, "microsoft-edge", "NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`));
      const manifest = JSON.parse(await readFile(path, "utf8"));
      expect(manifest.name).toBe(NATIVE_HOST_NAME);
      expect(manifest.type).toBe("stdio");
      expect(manifest.allowed_origins).toEqual([`chrome-extension://${extensionId}/`]);
      expect(manifest.path.startsWith("/")).toBe(true);
    } finally {
      await rm(config, { recursive: true, force: true });
    }
  });

  test("rejects invalid extension IDs", async () => {
    await expect(installNativeHost("invalid", process.execPath)).rejects.toThrow("extension ID");
  });
});
