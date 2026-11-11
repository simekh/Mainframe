# Third-party notices

Mainframe adapts code from Parallel Code (https://github.com/johannesjo/parallel-code) at commit 97c3558, used under the MIT License below. Each adapted file starts with a comment naming its source.

## Adapted files

<!-- one line per adapted file: Mainframe path ← Parallel Code path -->

- `scripts/fix-node-pty-spawn-helper.mjs` ← `scripts/fix-node-pty-spawn-helper.mjs`
- `src/main/pty/outputBatcher.ts` ← `electron/ipc/pty.ts` (`attachPtyOutputHandlers`)
- `src/main/clipboard.ts` ← `electron/ipc/register.ts` (`ResolveClipboardPaste`), rewritten for Electron 44's async clipboard
- `src/main/git.ts` ← `electron/ipc/git.ts` (`getChangedFiles`)
- `src/renderer/src/terminal/osc52.ts` (+ test) ← `src/lib/terminalClipboard.ts` (+ test)
- `src/renderer/src/terminal/copyText.ts` (+ test) ← `src/lib/copy-text.ts` (+ test)
- `src/renderer/src/terminal/escapePath.ts` (+ test) ← `src/lib/terminalDrop.ts` (`escapePath` and its cases)
- `src/renderer/src/terminal/webglLoss.ts` (+ test) ← `src/lib/webglContextLoss.ts` (+ test)
- `src/renderer/src/terminal/keybindings.ts` ← key sequences from `src/lib/keybindings/defaults.ts`
- `src/shared/httpUrl.ts` (+ test) ← `src/lib/terminalLinks.ts` (+ test) (`normalizeHttpUrl`)
- `src/renderer/src/terminal/terminalLinks.ts` (+ test) ← `src/lib/terminalLinks.ts` (+ test) (`createTerminalHttpLinkHandler`; no file-path links)
- `src/renderer/src/terminal/inputBatcher.ts` ← `src/components/TerminalView.tsx` (`enqueueInput`)
- `src/renderer/src/terminal/outputFlow.ts` ← `src/components/TerminalView.tsx` (`enqueueOutput`, `flushOutputQueue`, `scheduleOutputFlush`)
- `src/renderer/src/terminal/TerminalView.tsx` ← `src/components/TerminalView.tsx` (WebGL attach/detach and context loss, clipboard, drop, key handler, the web-links addon and `linkHandler` wiring, mousedown guard on link clicks)
- `src/renderer/src/terminal/registry.ts` ← `src/lib/terminalFitManager.ts` (`redrawAllTerminals`)
- `src/renderer/src/terminal/terminalOptions.ts` ← colours from `src/lib/parallelCodeTerminalTheme.ts`
- `src/renderer/src/app.css` ← colours, fonts and scrollbar of the default look in `src/styles.css` (`html[data-look='parallel-code']`)
- `src/renderer/src/app.css` (board, lanes and cards) ← `src/components/task-board.css`
- `src/renderer/src/board/StatusGlyph.tsx` and its `app.css` rules ← `src/components/StatusDot.tsx` (with `StatusCheckIcon` from `src/components/icons.tsx` and the `.status-glyph` rules of `src/styles.css`)
- `src/renderer/src/board/cardMoves.ts` ← `src/components/task-board-motion.ts` (`planCardMotion`'s sub-pixel rule, `useCardMotion`'s cancel-before-measure and ghost hiding)
- `src/renderer/src/board/TaskCard.tsx` ← `src/components/TaskBoardCard.tsx` (handing the focus to a card rebuilt in its new lane)
- `src/renderer/src/panel/ChangedFiles.tsx` ← `src/components/ChangedFilesList.tsx` (polling every 5 s while the window shows, with a cancel flag and an in-flight guard)
- `src/renderer/src/app.css` (the changed files' pane heading and line counts) ← `.task-pane-heading` in `src/styles.css` and `.task-board-diff` in `src/components/task-board.css`
- `src/renderer/src/board/lanes.ts` (`nextNeedsYou`) ← `src/components/next-attention-task.ts` (`stepInQueue`: wrapping around, and where it starts when the current task isn't in the queue)
- `src/renderer/src/board/shortcuts.ts` ← `src/lib/keybindings/defaults.ts` (`app.nav.next-attention` and `app.nav.previous-attention`: Ctrl+Tab and Ctrl+Shift+Tab, Ctrl on macOS too)
- `src/renderer/src/app.css` (the card's suggestion ring) ← `kanban-flash` in `src/components/kanban.css` and `statusPulse` in `src/styles.css`

## Adapted from xterm.js

Mainframe adapts code from xterm.js (https://github.com/xtermjs/xterm.js) at 6.1.0-beta.195, used under the MIT License below. Each adapted file starts with a comment naming its source.

<!-- one line per adapted file: Mainframe path ← xterm.js path -->

- `src/renderer/src/terminal/termStyle.ts` ← `src/common/InputHandler.ts` (`_extractColor`) and `src/common/parser/Params.ts` (`Params`)

## Fonts

Inter, Sora and JetBrains Mono are bundled from the `@fontsource` packages under the SIL Open Font License 1.1; each package's `LICENSE` file holds its copyright notice.

## Parallel Code license

```
MIT License

Copyright (c) 2026 Johannes Millan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## xterm.js license

```
Copyright (c) 2017-2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)
Copyright (c) 2014-2016, SourceLair Private Company (https://www.sourcelair.com)
Copyright (c) 2012-2013, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
