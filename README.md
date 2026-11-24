# teams-ic3

Small **IC3-only** Microsoft Teams CLI for automation.

- **No Graph**
- **No Playwright**
- **No browser login**
- Built in **TypeScript**
- Compiles to a native binary with **Bun**

This project is intentionally narrow: read chats, search messages, and send/manage messages using an IC3 token that you already have.

## Status

Usable MVP.

Implemented commands:

- `install`
- `auth-status`
- `whoami`
- `summary`
- `chats`
- `chat`
- `read`
- `search`
- `user-search`
- `chat-send`
- `send`
- `reply`
- `edit`
- `delete`
- `listen`

## Auth

The Edge extension sends an IC3 token to the native messaging host, which validates it and stores it in the local cache. `TEAMS_IC3_TOKEN` is not used. The region defaults to `emea`; `TEAMS_REGION` can override it in the host's environment.

Build the native binary, load the extension in Edge, and copy its ID from `edge://extensions`. On Linux, register the host for that specific extension:

```bash
./teams-ic3 install <edge-extension-id>
```

The registered manifest points to the current binary. Run `install` again if the binary moves or the extension ID changes. See [`webextension/README.md`](webextension/README.md) for setup and troubleshooting.

Edge launches the host with the extension origin as an argument. Running `teams-ic3` without arguments also starts the host. Use `teams-ic3 help` for CLI help.

The native messaging protocol uses UTF-8 JSON with a 4-byte length in native byte order. The host accepts `{"ic3":"<token>","region":"emea"}`; `region` is optional. It returns `{"ok":true}` after validation and storage, or `{"ok":false,"error":"..."}` on failure. It never returns the token. The host accepts messages up to 64 KiB.

## Proxy

The CLI and native messaging host use Bun's proxy environment variables for Microsoft API requests, including token validation. Set `HTTPS_PROXY` for Teams HTTPS requests. Bun also supports `HTTP_PROXY` for HTTP requests, `ALL_PROXY` as a fallback, lowercase equivalents, and `NO_PROXY` to bypass the proxy for selected hosts.

```bash
export HTTPS_PROXY=http://proxy.example.com:8080
export NO_PROXY=localhost,127.0.0.1,.example.internal
teams-ic3 auth-status --check
```

HTTP and HTTPS proxy URLs can include credentials, for example `http://user:password@proxy.example.com:8080`. Treat these URLs as secrets. TLS certificate verification remains enabled; if your proxy intercepts TLS, configure the corporate CA with `NODE_EXTRA_CA_CERTS` rather than disabling verification.

The native host inherits its environment from Edge, not from the shell that runs the CLI. Set the proxy and CA variables in Edge's launch environment as well if token validation requires the proxy. This support is tested with Bun 1.4.5.

## Build

```bash
bun install
bun run build
```

Binary output:

```bash
./teams-ic3
```

## Usage

```bash
teams-ic3 help
teams-ic3 auth-status --check
teams-ic3 whoami
teams-ic3 chats -n 10
teams-ic3 chat 2 -n 20
teams-ic3 read 3
teams-ic3 search terraform --json
teams-ic3 search terraform --chat 2
teams-ic3 user-search "Willian Gates"
teams-ic3 chat-send 2 "hola"
teams-ic3 send "William Gates" "hola"
teams-ic3 reply 4 "ok, visto"
teams-ic3 edit 4 "texto corregido"
teams-ic3 delete 4 --yes
teams-ic3 listen --poll-seconds 180
```

### Read message text from stdin

Useful for scripts and pipes:

```bash
printf 'hola desde stdin\n' | teams-ic3 chat-send 2 --stdin
printf 'respuesta larga\n' | teams-ic3 reply 4 --stdin
printf 'texto nuevo\n' | teams-ic3 edit 4 --stdin
printf 'hola\n' | teams-ic3 send "William Gates" --stdin
```

If you omit message text and stdin is piped, the CLI also reads from stdin automatically.

## Exit codes

- `0` success
- `1` generic error
- `2` usage / invalid input
- `3` auth not available locally
- `4` Teams API returned `401`

## Local files

Cache files:

- `~/.cache/teams-ic3/tokens.json`
- `~/.cache/teams-ic3/id_map.json`

The message/chat number mapping is local and ephemeral:

- `chats` populates chat numbers
- `chat` populates message numbers
- `search` also repopulates message numbers

## Listen mode

`listen` is a deterministic poller that watches recent Teams chats for messages that start with a trigger prefix, by default `@pi`.

When it sees a matching message, it:

1. deduplicates by conversation id + message id
2. invokes `pi` in oneshot print mode
3. captures the final stdout response
4. posts that response back as a reply to the triggering message

Example:

```bash
teams-ic3 listen \
  --poll-seconds 180 \
  --trigger '@pi' \
  --pi-bin pi \
  --pi-timeout-seconds 600
```

Useful flags:

- `--once` run one scan and exit
- `--startup-lookback-seconds N` process recent matching messages on first startup instead of only future ones
- `--pi-session <path|id>` reuse a fixed Pi session instead of `--no-session`
- `--state-file <path>` custom dedupe state file
- `--lock-file <path>` custom lock file
- `--max-reply-chars N` truncate long replies before sending

Notes:

- default behavior skips backlog on first start unless you set `--startup-lookback-seconds`
- non-self messages are processed in normal chats; self-chat (`48:notes`) is also supported for testing
- the wrapper sends the Teams reply; Pi is instructed not to send the Teams message itself

## Limitations

Important limitations are intentional:

- **IC3-only**: no Graph support
- `user-search` and `send <user-query>` are **best effort** from known chats and recent messages
- Global `search` is **best effort**, not a server-side indexed search
- No presence/status command
- No automated browser-based login flow; the user must already be signed in to Teams
- No attachments yet
- 1:1 name resolution is not guaranteed outside known context

## Development

Run directly:

```bash
bun run index.ts chats --json
```

Run tests:

```bash
bun test
```

Rebuild native binary:

```bash
bun run build
```
