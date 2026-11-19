import { createEffect, createSignal, For, on, Show } from 'solid-js';
import { imageUrl } from '../../../shared/imageUrl';
import type { ImageEntry } from '../../../shared/types';
import { imagesOf, openImage } from './imagesStore';

// A thumbnail doesn't take the focus on click: the full-size view gives it back to the terminal when it closes.
const keepFocus = (e: MouseEvent) => e.preventDefault();

function Thumb(props: { sessionId: string; index: number; entry: ImageEntry }) {
  const [gone, setGone] = createSignal(false);
  const name = () => (props.entry.number === null ? props.entry.name : `Image #${props.entry.number}, ${props.entry.name}`);
  return (
    <button
      type="button"
      class="image-thumb"
      classList={{ 'image-thumb--gone': gone() }}
      data-testid="image-thumb"
      title={name()}
      aria-label={gone() ? `${name()}, not available` : name()}
      onMouseDown={keepFocus}
      onClick={() => openImage(props.sessionId, props.index)}
    >
      <Show when={!gone()} fallback={<span class="image-thumb-gone">Not available</span>}>
        {/* The name in the fragment, which the protocol ignores: an image forgotten off the end leaves its place to the
            next one, and the cache would show the old picture at the old address. */}
        <img src={`${imageUrl(props.sessionId, props.index)}#${encodeURIComponent(props.entry.name)}`} alt="" draggable={false} onError={() => setGone(true)} />
      </Show>
      <Show when={props.entry.number !== null}>
        <span class="image-thumb-n">#{props.entry.number}</span>
      </Show>
    </button>
  );
}

/** The session's images under its terminal, newest on the right; nothing while it has none. */
export default function ImageStrip(props: { sessionId: string }) {
  let thumbs: HTMLDivElement | undefined;
  // A new image comes in on the right: scrolled into view when the strip overflows.
  createEffect(on(() => imagesOf(props.sessionId).length, () => thumbs?.scrollTo({ left: thumbs.scrollWidth })));
  return (
    <Show when={imagesOf(props.sessionId).length > 0}>
      <div class="image-strip" data-testid="image-strip" role="group" aria-label="Images">
        <span class="image-strip-label">Images</span>
        <div class="image-strip-thumbs" ref={thumbs}>
          <For each={imagesOf(props.sessionId)}>{(entry, i) => <Thumb sessionId={props.sessionId} index={i()} entry={entry} />}</For>
        </div>
      </div>
    </Show>
  );
}
