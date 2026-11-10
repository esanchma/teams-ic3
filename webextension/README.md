# Teams IC3 for Edge

This extension connects an existing authenticated Teams session to the local `teams-ic3` host. It does not sign in for you.

## Installation

1. Build the executable from the root directory: `bun run build`.
2. In Edge, open `edge://extensions` and enable **Developer mode**.
3. Select **Load unpacked** and choose the `webextension/` directory.
4. Copy the ID shown on the extension card in Edge.
5. On Linux, register the host for that ID:

   ```bash
   ./teams-ic3 install <extension-id>
   ```

6. Open or reload `https://teams.cloud.microsoft/` while signed in, and open a chat. Check the result with `./teams-ic3 auth-status --check`.

An unpacked extension ID can change when the extension is moved or reloaded. If it changes, repeat step 5. The host manifest also contains the absolute path to the executable: reinstall the host if you move the binary. The current installer supports Edge on Linux.

If you installed the earlier test version from `extension/`, disable or remove it. That version printed the token to the console.

## How it works

The extension observes the headers of chat requests to `teams.cloud.microsoft`. If it finds a Bearer JWT with the audience `https://ic3.teams.office.com`, it sends the token to the `com.teams_ic3.host` host via Native Messaging. The host validates the token with Teams and saves it in the local `teams-ic3` cache.

The extension avoids resending the same token during the service worker's lifetime. If the host fails, it waits 30 seconds and retries when it observes another chat request. It does not use its own storage or display the token in the console. The region is taken from the host configuration and defaults to `emea`.

This does not guarantee a permanent session: Edge and Teams must be able to generate new requests, and you may need to sign in again. The format and Teams APIs may change.

## Troubleshooting and privacy

In `edge://extensions`, open the Teams IC3 **service worker** to see status messages. If the token is not saved, check the registered ID, the executable path, and that Teams is authenticated. Reload Teams or open a chat to generate another request. `auth-status --check` checks the cached token; an older cache may still exist even if the extension fails.

The token is a credential. The extension sends it only to the local native host; it does not print or store the token itself. Do not share tokens or screenshots containing them. If a credential has been exposed, follow your organization's revocation procedure.
