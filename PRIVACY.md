# Privacy

Mainframe is a desktop app that runs on your own computer. It has no server, no account of its own, and no analytics or tracking. Nobody who makes Mainframe receives any of your data.

## Trello

When you connect Trello, Mainframe signs you in through Atlassian in your browser and talks to Trello directly from your computer.

- **What it reads:** the boards you can see (to let you pick one), and for the list you pick: its cards, their descriptions, checklists and labels, and the board's lists and labels. It also reads your Trello username, to show whom you are connected as. The username stays in memory and is never written to disk.
- **What it keeps:** the cards of the list you picked, saved in Mainframe's data folder on your computer so the Todo panel can show them offline. When you start a task from a card, the card's text is kept with that task. Your Trello sign-in is kept encrypted by your system's credential store, such as the macOS Keychain (on Linux without a keyring, Mainframe keeps you signed in only until it quits).
- **Where it goes:** a card's text goes into the opening prompt of the task you start from it. That task runs in the coding agent you chose (for example Claude Code, OpenCode or Codex), which sends its prompts to its own AI provider under that provider's terms. Mainframe sends your Trello data nowhere else.
- **Changes in Trello:** Mainframe asks for permission to change your boards so it can move a card as its task starts or finishes. It changes a card only for a task you started or something you did in Mainframe.
- **Disconnecting:** Disconnect in Settings deletes the sign-in from your computer. To also revoke Mainframe's access on Atlassian's side, remove it under Connected apps in your Atlassian account settings. Deleting Mainframe's data folder removes the saved cards and tasks.

## Other network use

Mainframe checks for its own updates with git, from the repository you installed it from. The coding agents it runs connect to their own services as they normally do.

## Questions

Open an issue at https://github.com/simekh/Mainframe/issues.
