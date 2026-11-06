// Adapted from Parallel Code (MIT): src/components/TerminalView.tsx at 97c3558. See THIRD_PARTY_NOTICES.md.
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { createEffect, on, onCleanup, onMount } from 'solid-js';
import type { RendererConfig } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import { subscribePty } from '../ptyEvents';
import { cleanCopiedTerminalText } from './copyText';
import { escapePath } from './escapePath';
import { InputBatcher } from './inputBatcher';
import { matchTerminalBinding, swallowsKeyEvent } from './keybindings';
import { handleOsc52Writes, trackRecentGesture } from './osc52';
import { OutputFlow } from './outputFlow';
import { redrawAllTerminals, registerTerminal, unregisterTerminal } from './registry';
import { TERMINAL_OPTIONS } from './terminalOptions';
import { recordSharedWebglContextLoss, WEBGL_REATTACH_DELAY_MS } from './webglLoss';

const EXIT_BANNER = '\r\n\x1b[90m[Process exited]\x1b[0m\r\n';
const RESIZE_INTERVAL_MS = 33;
const OUTPUT_FLUSH_FALLBACK_MS = 50;
const WEBGL_DETACH_DELAY_MS = 1000;

/** The earlier of the next animation frame and a fallback timer: frames can stop in a background window. */
function scheduleFrame(flush: () => void): () => void {
  let pending = true;
  const run = () => {
    if (!pending) return;
    cancel();
    flush();
  };
  const raf = requestAnimationFrame(run);
  const timer = setTimeout(run, OUTPUT_FLUSH_FALLBACK_MS);
  function cancel() {
    pending = false;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
  }
  return cancel;
}

export default function TerminalView(props: { sessionId: string; selected: boolean; config: RendererConfig }) {
  let container!: HTMLDivElement;
  const api = window.thesource;

  onMount(() => {
    const id = props.sessionId;
    const term = new Terminal({ ...TERMINAL_OPTIONS });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // Emoji are two columns wide, as Claude Code counts them; xterm's default (Unicode 6) makes
    // many of them one, which pushes table borders out of line.
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    term.open(container);
    registerTerminal(id, { term, fit });

    // --- Fit ---------------------------------------------------------------------------------
    // Every terminal sits in the one well, whose height follows the selected task's files. A
    // terminal off screen keeps the size it last fitted at, so its session isn't resized on every
    // switch; once on screen again it fits only if its container changed meanwhile.
    let fitted = { width: 0, height: 0 };
    const fitToContainer = () => {
      fitted = { width: container.clientWidth, height: container.clientHeight };
      fit.fit();
    };
    const fitIfResized = () => {
      if (container.clientWidth !== fitted.width || container.clientHeight !== fitted.height) fitToContainer();
    };

    // --- WebGL only while on screen ----------------------------------------------------------
    let webgl: WebglAddon | undefined;
    let reattachTimer: ReturnType<typeof setTimeout> | undefined;
    let detachTimer: ReturnType<typeof setTimeout> | undefined;

    const attachWebgl = () => {
      if (webgl || !props.selected) return;
      try {
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          // A loss reported by an addon already detached is our own loseContext() below.
          if (webgl !== addon) return;
          addon.dispose();
          webgl = undefined;
          if (recordSharedWebglContextLoss()) {
            reattachTimer = setTimeout(() => {
              reattachTimer = undefined;
              attachWebgl();
            }, WEBGL_REATTACH_DELAY_MS);
          }
        });
        // loadAddon repaints this terminal in full; no redraw needed (it would garble the others).
        term.loadAddon(addon);
        webgl = addon;
      } catch {
        // No WebGL2: xterm keeps the DOM renderer.
        return;
      }
      // WebGL's cells are whole device pixels, so fewer columns can fit than the DOM renderer
      // measured: fit again, with the renderer the terminal now shows in.
      fitToContainer();
    };

    // No fit: the terminal is off screen by now, and a resize would only signal the session.
    const detachWebgl = () => {
      if (reattachTimer !== undefined) clearTimeout(reattachTimer);
      reattachTimer = undefined;
      const addon = webgl;
      if (!addon) return;
      webgl = undefined;
      const canvas = term.element?.querySelector('canvas');
      addon.dispose();
      // dispose() drops the canvas, but Chromium keeps the context until it is garbage collected.
      // Lose it now to free its slot.
      try {
        canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        // Context already gone.
      }
    };

    // A terminal on screen from the start fits with WebGL before its session starts, so the session
    // starts at the size it shows. Any other fits with the DOM renderer.
    attachWebgl();
    if (!webgl) fitToContainer();

    // --- Input -------------------------------------------------------------------------------
    let exited = false;
    const input = new InputBatcher({ intervalMs: props.config.inputBatchMs, send: (d) => api.write(id, d) });
    term.onData((d) => {
      if (!exited) input.push(d);
    });

    term.attachCustomKeyEventHandler((e) => {
      if (swallowsKeyEvent(e)) return false;
      const action = matchTerminalBinding(e);
      if (!action) return true;
      e.preventDefault();
      if ('send' in action) {
        term.input(action.send, true);
      } else if (action.scroll === 'line-up') term.scrollLines(-1);
      else if (action.scroll === 'line-down') term.scrollLines(1);
      else if (action.scroll === 'page-up') term.scrollPages(-1);
      else term.scrollPages(1);
      return false;
    });

    // --- Output, with flow control -----------------------------------------------------------
    let cancelFlush: (() => void) | undefined;
    const flow = new OutputFlow({
      write: (data, done) => term.write(data, done),
      pause: () => api.pause(id),
      resume: () => api.resume(id),
      schedule: (flush) => (cancelFlush = scheduleFrame(flush)),
    });
    const finish = () => {
      if (exited) return;
      exited = true;
      input.dispose();
    };
    // Subscribed before spawning, so no output is missed.
    const unsubscribe = subscribePty(id, {
      data: (d) => flow.push(d),
      exit: () => {
        finish();
        flow.whenDrained(() => term.write(EXIT_BANNER));
      },
    });

    // --- Size --------------------------------------------------------------------------------
    let sent = { cols: term.cols, rows: term.rows };
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let lastResizeAt = Number.NEGATIVE_INFINITY;
    const sendResize = () => {
      resizeTimer = undefined;
      lastResizeAt = performance.now();
      if (exited || (term.cols === sent.cols && term.rows === sent.rows)) return;
      sent = { cols: term.cols, rows: term.rows };
      api.resize(id, sent.cols, sent.rows);
    };
    term.onResize(() => {
      if (resizeTimer !== undefined) return;
      const wait = Math.max(0, RESIZE_INTERVAL_MS - (performance.now() - lastResizeAt));
      resizeTimer = setTimeout(sendResize, wait);
    });
    // Re-fits on screen only when the container's size changes: its first report is the size the
    // session spawns at below. A change of renderer fits in attachWebgl.
    const observer = new ResizeObserver(() => {
      if (props.selected) fitIfResized();
    });
    observer.observe(container);

    // An e2e run spawns through its test hooks, which record the size.
    const spawn = window.__thesourceE2E?.spawn ?? api.spawn;
    spawn({ sessionId: id, cols: sent.cols, rows: sent.rows }).catch((err: unknown) => {
      term.write(`\x1b[31mCould not start the session: ${errorMessage(err)}\x1b[0m\r\n`);
      finish();
    });

    // --- Clipboard and drop ------------------------------------------------------------------
    // Cmd+V belongs to the Edit menu, which fires a DOM paste event. Main resolves the clipboard:
    // a Finder file or an image becomes a path. term.paste adds bracketed-paste markers when the
    // program asked for them; without them Claude Code doesn't attach a pasted path as an image.
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      api
        .resolvePaste()
        .then((paste) => {
          if (paste.kind === 'file' || paste.kind === 'image') term.paste(escapePath(paste.path));
          else if (paste.kind === 'text') term.paste(paste.text);
        })
        .catch((err: unknown) => console.warn('[terminal] paste failed', err));
    };
    // Cmd+C (Edit menu): copy the selection without TUI padding and with wrapped lines rejoined.
    const onCopy = (e: ClipboardEvent) => {
      const selection = term.getSelection();
      if (!selection || !e.clipboardData) return;
      e.preventDefault();
      e.stopPropagation();
      e.clipboardData.setData('text/plain', cleanCopiedTerminalText(selection));
    };
    // Finder files dropped on the terminal become their escaped paths.
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const paths = [...e.dataTransfer.files]
        .map((file) => api.getPathForFile(file))
        .filter(Boolean)
        .map(escapePath)
        .join(' ');
      if (!paths) return;
      term.focus();
      term.paste(paths);
    };
    container.addEventListener('paste', onPaste, true);
    container.addEventListener('copy', onCopy, true);
    container.addEventListener('dragover', onDragOver, true);
    container.addEventListener('drop', onDrop, true);

    // Claude Code's fullscreen mode keeps its own selection and copies with OSC 52. Allowed only
    // right after the owner clicked or typed here, so replayed output never re-copies.
    const gesture = trackRecentGesture(container);
    const osc52 = handleOsc52Writes(term, {
      allowed: gesture.isRecent,
      write: (text) => {
        navigator.clipboard.writeText(text).catch((err: unknown) => console.warn('[terminal] OSC 52 copy failed', err));
      },
    });

    createEffect(
      on(
        () => props.selected,
        (selected, wasSelected) => {
          if (selected) {
            if (detachTimer !== undefined) clearTimeout(detachTimer);
            detachTimer = undefined;
            if (!webgl && reattachTimer === undefined) attachWebgl();
            // A WebGL surface throttled while hidden can come back with a corrupt glyph atlas.
            else if (webgl && wasSelected === false) redrawAllTerminals();
            // The well as it is now, with this task's own panel laid out: the window or this
            // task's files may have changed it while the terminal was off screen.
            fitIfResized();
            term.focus();
          } else if (detachTimer === undefined) {
            detachTimer = setTimeout(() => {
              detachTimer = undefined;
              detachWebgl();
            }, WEBGL_DETACH_DELAY_MS);
          }
        },
      ),
    );

    onCleanup(() => {
      unsubscribe();
      cancelFlush?.();
      observer.disconnect();
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      if (detachTimer !== undefined) clearTimeout(detachTimer);
      container.removeEventListener('paste', onPaste, true);
      container.removeEventListener('copy', onCopy, true);
      container.removeEventListener('dragover', onDragOver, true);
      container.removeEventListener('drop', onDrop, true);
      gesture.dispose();
      osc52.dispose();
      input.dispose();
      detachWebgl();
      unregisterTerminal(id);
      term.dispose();
    });
  });

  return <div class="terminal" classList={{ 'terminal--hidden': !props.selected }} ref={container} />;
}
