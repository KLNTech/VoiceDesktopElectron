# VoiceDesktopElectron

A macOS desktop application that turns a CLI agent session into a living Markdown map.

## Idea

You keep prompting a CLI agent in your terminal. The conversation scrolls away, and what
you actually learned — decisions, findings, open questions — ends up buried in scrollback.

VoiceDesktopElectron watches that session and maintains a Markdown document alongside it:

- every prompt you send to the CLI agent either **creates a new node** or **updates an
  existing one** in the Markdown tree,
- the Markdown file is the single source of truth — plain text, diffable, yours,
- the desktop window renders the tree live while you keep working in the terminal.

Voice input is the intended way to drive it: speak the prompt, get the node.

## Status

Initial scaffold. Nothing is implemented yet — this commit records the concept and the
repository layout.

## Planned stack

- Electron (macOS target)
- Node.js main process for session capture and Markdown persistence
- Markdown-on-disk as the storage format (no database)

## License

TBD
