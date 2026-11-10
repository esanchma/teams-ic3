# teams-ic3 Command Reference

Run commands from the deployed skill directory.

## Read

Summary:

```bash
./teams-ic3 summary --json
```

List chats:

```bash
./teams-ic3 chats -n 20 --json
```

Read one chat:

```bash
./teams-ic3 chat <chat-num-or-id> -n 30 --json
```

Read one message from the current id map:

```bash
./teams-ic3 read <message-num> --json
```

## Search

Search messages globally:

```bash
./teams-ic3 search "<query>" --json
```

Search messages inside one chat:

```bash
./teams-ic3 search "<query>" --chat <chat-num-or-id> --json
```

Search known users:

```bash
./teams-ic3 user-search "<name>" --json
```

## Write

Send to an existing chat:

```bash
printf '%s\n' "message" | ./teams-ic3 chat-send <chat-num-or-id> --stdin --json
```

Send to a known user by name or user id:

```bash
printf '%s\n' "message" | ./teams-ic3 send "<user-query>" --stdin --json
```

Reply to a message number:

```bash
printf '%s\n' "message" | ./teams-ic3 reply <message-num> --stdin --json
```

Edit a message number:

```bash
printf '%s\n' "new text" | ./teams-ic3 edit <message-num> --stdin --json
```

Delete a message number:

```bash
./teams-ic3 delete <message-num> --yes --json
```

Listen for `@pi` triggers and invoke Pi in oneshot mode:

```bash
./teams-ic3 listen --poll-seconds 180 --trigger '@pi'
```

Run one scan only:

```bash
./teams-ic3 listen --once --startup-lookback-seconds 120
```

## Notes

- Prefer `--json` for machine-readable output.
- Prefer `--stdin` for long or multiline message bodies.
- Chat and message numbers are local and can be repopulated by `chats`, `chat`, and `search`.
- `user-search` and `send <user-query>` are best effort from known IC3-visible context.
