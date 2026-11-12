import { Show } from 'solid-js';

/** Line counts; a count that is zero or that git doesn't give shows nothing. */
export default function LineCounts(props: { added: number | null; removed: number | null }) {
  return (
    <span class="diff">
      <Show when={props.added}>{(n) => <span class="add">+{n()}</span>}</Show>
      <Show when={props.removed}>{(n) => <span class="rem">−{n()}</span>}</Show>
    </span>
  );
}
