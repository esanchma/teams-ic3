---
name: teams-ic3
description: Use the local teams-ic3 CLI to read chats, search messages, resolve known users, and send or manage Microsoft Teams messages via IC3-only auth. Use when the user wants to inspect or operate Teams conversations from this machine without Graph, browser login, or Playwright.
---

# Teams IC3

Use this skill when the user wants to work with Microsoft Teams through the local IC3-only CLI binary.

After deployment, the skill directory contains the binary at `./teams-ic3`.

Use this skill for practical Teams operations from the terminal:
- read chats and messages
- search messages
- resolve known users
- send messages
- reply
- edit
- delete

Do not use this skill for Graph APIs, presence/status, browser login, or Playwright flows.

## Preconditions

Authentication uses the local token cache populated by the Edge extension in `webextension/` and the native messaging host. `TEAMS_IC3_TOKEN` is not used. `TEAMS_REGION` optionally sets the host's default region.

Do not implement browser login or recover auth through Playwright.

## Safety and Etiquette Rules

Follow these rules strictly:

1. Prefer read operations before write operations.
2. Do not send any message unless the user explicitly asked to send, reply, edit, or delete.
3. If the target user is ambiguous, stop and ask instead of guessing.
4. Be especially careful with group chats. Do not write to a group unless the user clearly intended that.
5. Before edit or delete, inspect the target message first when practical.
6. Prefer self-chat (`48:notes`) for harmless validation when a write path must be tested.
7. Use `--json` whenever the output needs to be inspected or reused.
8. Prefer `--stdin` for long or multiline message bodies.
9. Do not assume chat numbers or message numbers remain stable across commands. They come from the local id map and may be repopulated.
10. Do not attempt presence/status or any Graph-only workflow.

## Command Mapping

Run the binary from the skill directory:

```bash
./teams-ic3 ...
```

Detailed examples: see [references/commands.md](references/commands.md).

## Recommended Workflows

### When the user wants to see recent activity

1. Run `./teams-ic3 summary --json`.
2. If needed, run `./teams-ic3 chats -n 20 --json`.
3. Open the relevant chat with `./teams-ic3 chat <ref> -n 30 --json`.

### When the user wants to find a message

1. Run `./teams-ic3 search "<query>" --json`.
2. If the user already identified a chat, prefer `./teams-ic3 search "<query>" --chat <ref> --json`.
3. If needed, use `./teams-ic3 read <message-num> --json` to inspect the exact target.

### When the user wants to message someone by name

1. Run `./teams-ic3 user-search "<name>" --json`.
2. If there is one clear match, proceed.
3. If multiple plausible matches exist, ask the user instead of guessing.
4. Send with `./teams-ic3 send "<user-query>" --stdin --json`.

### When the user wants to reply

1. Identify the exact message with `chat`, `search`, or `read`.
2. Confirm the message reference is current.
3. Use `./teams-ic3 reply <message-num> --stdin --json`.

### When the user wants to edit or delete

1. Inspect the message first with `./teams-ic3 read <message-num> --json` when practical.
2. Only then run `edit` or `delete`.
3. For delete in automation, use `--yes`.
4. Be aware that deleted messages may still be readable as empty content rather than disappearing completely from later reads.

## Known Limitations

Treat these as hard constraints:

- IC3-only. No Graph support.
- No browser login.
- No Playwright.
- No presence/status command.
- `user-search` is best effort from known chats and recent messages, not a full directory search.
- `send "<user-query>"` depends on IC3-visible known context and may fail for unknown users.
- Global `search` is best effort, not a server-side indexed full-history search.
- Chat numbers and message numbers come from the local id map and can change after `chats`, `chat`, or `search`.
- No attachment workflow yet.

## Operational Notes

If a numbered chat or message reference fails:

1. Repopulate chat refs with `./teams-ic3 chats --json`.
2. Repopulate message refs with `./teams-ic3 chat <ref> --json` or `./teams-ic3 search "<query>" --json`.
3. Retry using the refreshed number or the real conversation id if available.

When parsing outputs or making decisions from command results, always prefer `--json`.
