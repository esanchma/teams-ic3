import { access, mkdir, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { UsageError } from "./cli";

export const NATIVE_HOST_NAME = "com.teams_ic3.host";

export async function installNativeHost(extensionId: string, executable: string, configDir = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")): Promise<string> {
  if (process.platform !== "linux") throw new UsageError("Native host installation currently supports Linux only.");
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new UsageError("Provide the 32-character Edge extension ID: teams-ic3 install <extension-id>");
  }
  const executablePath = await realpath(executable);
  await access(executablePath, constants.X_OK);
  const directory = join(configDir, "microsoft-edge", "NativeMessagingHosts");
  const manifestPath = join(directory, `${NATIVE_HOST_NAME}.json`);
  const manifest = {
    name: NATIVE_HOST_NAME,
    description: "Teams IC3 native messaging host",
    path: executablePath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  await mkdir(directory, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifestPath;
}
