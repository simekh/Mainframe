# Third-party notices

TheSource adapts code from Parallel Code (https://github.com/johannesjo/parallel-code) at commit 97c3558, used under the MIT License below. Each adapted file starts with a comment naming its source.

## Adapted files

<!-- one line per adapted file: TheSource path ← Parallel Code path -->

- `scripts/fix-node-pty-spawn-helper.mjs` ← `scripts/fix-node-pty-spawn-helper.mjs`
- `src/main/pty/outputBatcher.ts` ← `electron/ipc/pty.ts` (`attachPtyOutputHandlers`)
- `src/main/clipboard.ts` ← `electron/ipc/register.ts` (`ResolveClipboardPaste`), rewritten for Electron 44's async clipboard
- `src/renderer/src/terminal/osc52.ts` (+ test) ← `src/lib/terminalClipboard.ts` (+ test)
- `src/renderer/src/terminal/copyText.ts` (+ test) ← `src/lib/copy-text.ts` (+ test)
- `src/renderer/src/terminal/escapePath.ts` (+ test) ← `src/lib/terminalDrop.ts` (`escapePath` and its cases)
- `src/renderer/src/terminal/webglLoss.ts` (+ test) ← `src/lib/webglContextLoss.ts` (+ test)
- `src/renderer/src/terminal/keybindings.ts` ← key sequences from `src/lib/keybindings/defaults.ts`
- `src/renderer/src/terminal/inputBatcher.ts` ← `src/components/TerminalView.tsx` (`enqueueInput`)
- `src/renderer/src/terminal/outputFlow.ts` ← `src/components/TerminalView.tsx` (`enqueueOutput`, `flushOutputQueue`, `scheduleOutputFlush`)
- `src/renderer/src/terminal/TerminalView.tsx` ← `src/components/TerminalView.tsx` (WebGL attach/detach and context loss, clipboard, drop, key handler)
- `src/renderer/src/terminal/registry.ts` ← `src/lib/terminalFitManager.ts` (`redrawAllTerminals`)
- `src/renderer/src/terminal/terminalOptions.ts` ← colours from `src/lib/parallelCodeTerminalTheme.ts`
- `src/renderer/src/app.css` ← colours, fonts and scrollbar of the default look in `src/styles.css` (`html[data-look='parallel-code']`)

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
