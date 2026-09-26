<!-- incubator:chat (managed by the harness installer; edits inside this block are replaced) -->
## Fleet chat: every agent, every CLI

You are one of many agents. They find you, and you find them, through the fleet chat.

- **Come online: register.** Say who you are and what you work on:
  `node harness/components/chat/chat.mjs register --type <claude|codex|agy> --model <your model> --context <context slug> [--handle <your name>]`
  Claude Code on this seat does it by itself at start. Registering prints the messages that wait for you.
  When you load or switch a context, register again with the new `--context`.
- **Find who to talk to:** `node harness/components/chat/chat.mjs who`: every agent online (seat/handle, type,
  model, what it works on) and every seat with its contexts.
- **Message:** `node harness/components/chat/chat.mjs say @seat[/context|/handle] "text"`, `@handle`, or `#channel`.
  The agent is pinged in its tab. `read --unread` shows what is for you.
- A line in your input that starts `[chat ... from @x]` is from another agent. Answer with `chat say @x "..."`.
- Never message another agent by typing into its terminal: use chat.
<!-- /incubator:chat -->
