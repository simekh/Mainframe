# Contributing to Mainframe

Thanks for wanting to help. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug or suggesting something

Open an issue. For a bug, say:

- your system (macOS, Windows 11 or Linux) and its version,
- your Node.js and Claude Code versions,
- what you did, what you expected and what happened instead.

A screenshot or the terminal output from `npm start` helps a lot.

## Before a bigger change

For anything more than a small fix, open an issue first and describe what you want to change and why. It saves you from writing something that doesn't fit.

## Setting up

You need the newest Node.js LTS, git, and Claude Code installed and logged in. See the [README](README.md) for details per system.

```sh
git clone https://github.com/simekh/Mainframe.git
cd Mainframe
npm install
npm run dev
```

## Checks to run

Run these before you open a pull request:

```sh
npm run typecheck
npm test
npm run test:e2e    # builds, then runs the Playwright + Electron tests
```

The end-to-end tests start Mainframe windows. If you already have Mainframe running, quit it first.

## What a good change looks like

- **Small and about one thing.** A fix and an unrelated cleanup are two pull requests.
- **No more code than it needs.** The simplest thing that meets the requirement wins. Delete code a change makes dead.
- **Works for everyone's project.** Mainframe knows no particular project. Don't hard-code a folder, a branch name such as `main`, a language, a test command or a tool. Anything specific to a project comes from that project's own files or from a setting.
- **Works with several projects open.** Mainframe shows many projects in one window. Don't add a "the project" that code reaches for instead of being handed its project.
- **Works on macOS, Windows and Linux.** Check paths, keys and shells on the systems you can. CI covers all three.
- **Current versions only.** Mainframe targets the newest Node.js LTS, a current Claude Code and Windows 11. Don't add workarounds for older versions.
- **Tests with the change.** A bug fix gets a test that fails without it.

## Pull requests

- Branch from `main`.
- Say what the change does and why, and how you checked it.
- Keep commit messages short and in the form "area: what changed".

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE), the same as the rest of the project.
