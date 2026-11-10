// Adapted from Parallel Code (MIT): src/components/TerminalView.tsx at 97c3558. See THIRD_PARTY_NOTICES.md.
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { createEffect, on, onCleanup, onMount } from 'solid-js';
import type { RendererConfig } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import { linkClickHeld } from '../keys';
import { subscribePty } from '../ptyEvents';
import { setSuggesting } from '../tasksStore';
import { cleanCopiedTerminalText } from './copyText';
import { escapePath } from './escapePath';
import { InputBatcher } from './inputBatcher';
import { matchTerminalBinding, swallowsKeyEvent } from './keybindings';
import { handleOsc52Writes, trackRecentGesture } from './osc52';
import { OutputFlow } from './outputFlow';
import { redrawAllTerminals, registerTerminal, unregisterTerminal } from './registry';
import { hasSuggestion } from './suggestion';
import { createTerminalHttpLinkHandler } from './terminalLinks';
import { BOLD_AND_LINK_COLORS, platformTerminalOptions, TERMINAL_OPTIONS } from './terminalOptions';
import { createTermStyler } from './termStyle';
import { recordSharedWebglContextLoss, WEBGL_REATTACH_DELAY_MS } from './webglLoss';

const EXIT_BANNER = '\r\n\x1b[90m[Process exited]\x1b[0m\r\n';
const RESIZE_INTERVAL_MS = 33;
const OUTPUT_FLUSH_FALLBACK_MS = 50;
const WEBGL_DETACH_DELAY_MS = 1000;
const SUGGESTION_SCAN_INTERVAL_MS = 250;
const SUGGESTION_SCAN_ROWS = 24;

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

export default function TerminalView(props: {
  sessionId: string;
  selected: boolean;
  /** Whether coming on screen puts the cursor in it; true unless set. */
  takeFocus?: boolean;
  config: RendererConfig;
}) {
  let container!: HTMLDivElement;
  const api = window.mainframe;

  onMount(() => {
    const id = props.sessionId;
    // Cmd+click (Ctrl+click on Windows and Linux) opens a link in the browser: a plain URL, found by
    // the web-links addon, and an OSC 8 link Claude Code prints, which xterm hands to linkHandler
    // (never a non-http one). A plain click still selects and focuses.
    const openLink = createTerminalHttpLinkHandler({
      openExternal: (url) => api.openLink(url),
      onOpenError: (err) => console.warn(`[terminal] could not open the link: ${errorMessage(err)}`),
      platform: api.platform,
    });
    const term = new Terminal({
      ...TERMINAL_OPTIONS,
      ...platformTerminalOptions(api.platform, props.config.windowsBuild),
      linkHandler: { activate: openLink, allowNonHttpProtocols: false },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon(openLink));
    // Emoji are two columns wide, as Claude Code counts them; xterm's default (Unicode 6) makes
    // many of them one, which pushes table borders out of line.
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    term.open(container);
    registerTerminal(id, { term, fit });

    // A Cmd+click (Ctrl+click on Windows and Linux) on a link is ours alone. xterm's own mousedown, on
    // the .xterm element above the screen, would also report it to a program that asks for the mouse,
    // as Claude Code does in fullscreen. This one sits on the screen itself, after the link handling
    // there, so the link still activates on the mouseup, and it stops the event before it rises to the
    // .xterm element.
    const linkScreen = term.element!.querySelector<HTMLElement>('.xterm-screen')!;
    const keepLinkClickHere = (e: MouseEvent) => {
      if (e.button !== 0 || !linkClickHeld(e, api.platform) || !linkScreen.classList.contains('xterm-cursor-pointer')) return;
      e.preventDefault();
      e.stopPropagation();
      term.focus();
    };
    linkScreen.addEventListener('mousedown', keepLinkClickHere);

    // --- Fit ---------------------------------------------------------------------------------
    // The tasks' terminals sit in the session panel's one well, whose height follows the selected
    // task's files; the manager's sits in its own column. A terminal off screen keeps the size it
    // last fitted at, so its session isn't resized on every switch; once on screen again it fits
    // only if its container changed meanwhile, or on Windows and Linux the scaling (a move to
    // another screen). The Mac keeps today's fit, as nothing changes on the Mac.
    const followsScaling = api.platform !== 'darwin';
    let fitted = { width: 0, height: 0, ratio: 0 };
    const fitToContainer = () => {
      fitted = { width: container.clientWidth, height: container.clientHeight, ratio: window.devicePixelRatio };
      fit.fit();
    };
    const fitIfResized = () => {
      if (
        container.clientWidth !== fitted.width ||
        container.clientHeight !== fitted.height ||
        (followsScaling && window.devicePixelRatio !== fitted.ratio)
      ) {
        fitToContainer();
      }
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
      const action = matchTerminalBinding(e, api.platform, term.hasSelection());
      if (!action) return true;
      // Also stops Chromium's own paste of a Ctrl+V into xterm's textarea, which would paste it twice.
      e.preventDefault();
      if ('send' in action) {
        term.input(action.send, true);
      } else if ('clipboard' in action) {
        if (action.clipboard === 'paste') pasteClipboard();
        else copySelection(action.clipboard === 'copy-and-clear');
      } else if (action.scroll === 'line-up') term.scrollLines(-1);
      else if (action.scroll === 'line-down') term.scrollLines(1);
      else if (action.scroll === 'page-up') term.scrollPages(-1);
      else term.scrollPages(1);
      return false;
    });

    // --- Suggestion ring ---------------------------------------------------------------------
    // The one place the app reads the screen: whether Claude Code shows a suggestion, for a ring on
    // the card. Never for a lane. It reads the bottom of the live screen, not the part in view, so
    // scrolling back changes nothing; a terminal off screen is read too.
    let scanTimer: ReturnType<typeof setTimeout> | undefined;
    const scan = () => {
      scanTimer = undefined;
      const buffer = term.buffer.active;
      const end = buffer.baseY + term.rows;
      const lines: string[] = [];
      for (let y = end - Math.min(term.rows, SUGGESTION_SCAN_ROWS); y < end; y++) {
        lines.push(buffer.getLine(y)?.translateToString(true) ?? '');
      }
      setSuggesting(id, hasSuggestion(lines));
    };
    // At most one scan per interval, and always one after the last output. A session that has
    // ended shows no ring whatever this finds: the ring needs a running session.
    term.onWriteParsed(() => (scanTimer ??= setTimeout(scan, SUGGESTION_SCAN_INTERVAL_MS)));

    // --- Output, with flow control -----------------------------------------------------------
    let cancelFlush: (() => void) | undefined;
    // One styler per terminal: it follows the output across writes. The flow still counts the
    // PTY's own bytes, the payload it hands over here.
    const style = createTermStyler(BOLD_AND_LINK_COLORS);
    const flow = new OutputFlow({
      write: (data, done) => term.write(style(data), done),
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
    // A change of scaling alone (a move to a screen with other scaling) leaves the container's size
    // as it is, so on Windows and Linux the resolution media query re-fits, the one xterm uses:
    // Chromium's device-pixel box doesn't follow every scale change (an emulated one, for one).
    // xterm's own listener, added by term.open, runs first, so its cells are re-measured by the time
    // this fits. A query matches one ratio, so each change re-arms it for the new one. The Mac has
    // none: it keeps today's fit, as nothing changes on the Mac.
    let scaling: MediaQueryList | undefined;
    const watchScaling = () => {
      scaling?.removeEventListener('change', onScalingChange);
      scaling = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      scaling.addEventListener('change', onScalingChange);
    };
    const onScalingChange = () => {
      watchScaling();
      if (props.selected) fitIfResized();
    };
    if (followsScaling) watchScaling();

    // An e2e run spawns through its test hooks, which record the size.
    const spawn = window.__mainframeE2E?.spawn ?? api.spawn;
    spawn({ sessionId: id, cols: sent.cols, rows: sent.rows }).catch((err: unknown) => {
      term.write(`\x1b[31mCould not start the session: ${errorMessage(err)}\x1b[0m\r\n`);
      finish();
    });

    // --- Clipboard and drop ------------------------------------------------------------------
    // The Mac's copy and paste go through the Edit menu, which fires DOM copy and paste events.
    // Windows and Linux use the terminal's own keys (the key handler above) and the right-click
    // menu, whose Copy and Paste fire the same events.
    // Main resolves the clipboard: a Finder file or an image becomes a path. term.paste adds
    // bracketed-paste markers when the program asked for them; without them Claude Code doesn't
    // attach a pasted path as an image.
    const pasteClipboard = () => {
      api
        .resolvePaste()
        .then((paste) => {
          if (paste.kind === 'file' || paste.kind === 'image') term.paste(escapePath(paste.path, api.platform));
          else if (paste.kind === 'text') term.paste(paste.text);
        })
        .catch((err: unknown) => console.warn('[terminal] paste failed', err));
    };
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      pasteClipboard();
    };
    // The selection is copied without TUI padding and with wrapped lines rejoined.
    const onCopy = (e: ClipboardEvent) => {
      const selection = term.getSelection();
      if (!selection || !e.clipboardData) return;
      e.preventDefault();
      e.stopPropagation();
      e.clipboardData.setData('text/plain', cleanCopiedTerminalText(selection));
    };
    // The copy keys of Windows and Linux. Main writes the clipboard: the page's own refuses when the
    // document isn't focused. A Ctrl+C clears the selection, so the next one interrupts.
    const copySelection = (clear: boolean) => {
      const selection = term.getSelection();
      if (selection) api.copyText(cleanCopiedTerminalText(selection));
      if (clear) term.clearSelection();
    };
    // Files dropped on the terminal become their paths, escaped or quoted for this system, one word each.
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
        .map((path) => escapePath(path, api.platform))
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
            if (props.takeFocus ?? true) term.focus();
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
      scaling?.removeEventListener('change', onScalingChange);
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      if (detachTimer !== undefined) clearTimeout(detachTimer);
      clearTimeout(scanTimer);
      setSuggesting(id, false);
      linkScreen.removeEventListener('mousedown', keepLinkClickHere);
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
