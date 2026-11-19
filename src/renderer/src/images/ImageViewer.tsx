import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { imageUrl } from '../../../shared/imageUrl';
import { closeImage, imagesOf, openImage, stepIndex, viewerState } from './imagesStore';

const SHOW_IN: Partial<Record<NodeJS.Platform, string>> = { darwin: 'Show in Finder', win32: 'Show in Explorer' };
const showInLabel = SHOW_IN[window.mainframe.platform] ?? 'Show in Folder';

/** "#3"; nothing for an agent whose images have no number. */
const numberOf = (n: number | null) => (n === null ? '' : `#${n}`);

/**
 * One image of a session at full size, over the whole window: mounted once, shown while `viewerState()` names an image.
 * Left and right step through the session's images, Esc closes. A file that is gone, which the image's load tells, shows
 * as not available, with the path it had.
 */
export default function ImageViewer() {
  let dialog!: HTMLDialogElement;
  let closeButton: HTMLButtonElement | undefined;
  // Each opening and step loads the file afresh under a fragment of its own, which the protocol drops: the page keeps an
  // image it has loaded by its whole URL, so a file deleted since its thumbnail loaded would still show.
  let opens = 0;
  const opening = createMemo(() => (viewerState(), ++opens));
  const shown = () => {
    const state = viewerState();
    if (!state) return null;
    const list = imagesOf(state.sessionId);
    const entry = list[state.index];
    return entry ? { ...state, entry, count: list.length, url: `${imageUrl(state.sessionId, state.index)}#${opening()}` } : null;
  };
  // What the last load or failure was, by URL: a step to another image starts without either.
  const [loaded, setLoaded] = createSignal<{ url: string; width: number; height: number } | null>(null);
  const [failed, setFailed] = createSignal<string | null>(null);
  const size = () => {
    const l = loaded();
    return l && l.url === shown()?.url ? l : null;
  };
  const gone = () => failed() === shown()?.url;

  createEffect(() => {
    if (shown() && !dialog.open) {
      dialog.showModal();
      // The close button is there whatever loads; Show in … comes and goes, and the focus would go with it.
      closeButton?.focus();
    } else if (!shown() && dialog.open) dialog.close();
  });

  const step = (delta: -1 | 1) => {
    const s = shown();
    if (!s) return;
    const to = stepIndex(s.index, s.count, delta);
    // At an end it stays, without loading the image again.
    if (to !== s.index) openImage(s.sessionId, to);
  };
  const neighbour = (delta: -1 | 1) => {
    const s = shown();
    if (!s) return null;
    const i = s.index + delta;
    return i >= 0 && i < s.count ? imagesOf(s.sessionId)[i] : null;
  };
  // On the window, so the arrows work wherever the focus is while the view is open: a step button at an end goes.
  const onKeyDown = (e: KeyboardEvent) => {
    if (dialog.open && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    }
  };
  window.addEventListener('keydown', onKeyDown);
  onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  const showInFolder = () => {
    const s = shown();
    if (s) window.mainframe.showImageInFolder(s.sessionId, s.index).catch((err: unknown) => console.warn('[images] could not show the file', err));
  };

  return (
    <dialog
      ref={dialog}
      class="image-viewer"
      data-testid="image-viewer"
      aria-labelledby="image-viewer-title"
      // A press here is not one on the board, which would fold the panels over it.
      onMouseDown={(e) => e.stopPropagation()}
      // A click on the dimmed window around the frame closes it, as Esc does.
      onClick={(e) => e.target === dialog && dialog.close()}
      onClose={closeImage}
    >
      <Show when={shown()}>
        {(s) => (
          <div class="iv">
            <header class="iv-bar">
              <h2 id="image-viewer-title" class="iv-title">
                <Show when={s().entry.number !== null}>
                  <b data-testid="image-viewer-number">{numberOf(s().entry.number)}</b>
                </Show>
                <span class="iv-name" title={s().entry.name}>
                  {s().entry.name}
                </span>
                <Show when={size()}>{(z) => <span class="iv-size">{`${z().width} × ${z().height}`}</span>}</Show>
              </h2>
              {/* Only once the file has loaded: a missing one never shows it, not even until its load fails. */}
              <Show when={size()}>
                <button class="btn" type="button" onClick={showInFolder}>
                  {showInLabel}
                </button>
              </Show>
              <button ref={closeButton} class="iv-close" type="button" aria-label="Close" title="Close" onClick={() => dialog.close()}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            </header>
            <div class="iv-stage">
              <Show
                when={!gone()}
                fallback={
                  <div class="iv-gone" data-testid="image-viewer-gone">
                    <strong>Not available</strong>
                    <span>The file has been moved or deleted.</span>
                    <code>{s().entry.path}</code>
                  </div>
                }
              >
                <img
                  src={s().url}
                  alt={s().entry.name}
                  draggable={false}
                  onLoad={(e) => setLoaded({ url: s().url, width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
                  onError={() => setFailed(s().url)}
                />
              </Show>
            </div>
            <footer class="iv-nav">
              <Show when={neighbour(-1)} fallback={<span />}>
                {(prev) => (
                  <button type="button" class="iv-step" aria-label="Previous image" onClick={() => step(-1)}>
                    ← {numberOf(prev().number)}
                  </button>
                )}
              </Show>
              <span class="iv-count">{`${s().index + 1} of ${s().count}`}</span>
              <Show when={neighbour(1)} fallback={<span />}>
                {(next) => (
                  <button type="button" class="iv-step" aria-label="Next image" onClick={() => step(1)}>
                    {numberOf(next().number)} →
                  </button>
                )}
              </Show>
            </footer>
          </div>
        )}
      </Show>
    </dialog>
  );
}
