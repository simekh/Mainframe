import { For, Show } from 'solid-js';
import type { DiffLine, FileDiff } from '../../../shared/types';
import { noteText } from './diffText';
import LineCounts from './LineCounts';

const MARKER: Record<DiffLine['kind'], string> = { add: '+', remove: '−', context: ' ' };

/** One file's heading and its hunks, or the note that stands in for them. */
export default function DiffFile(props: { file: FileDiff }) {
  return (
    <section class="diff-file" data-testid="diff-file" data-path={props.file.path}>
      <h2 class="diff-file-head">
        <span class="path">{props.file.path}</span>
        <LineCounts added={props.file.added} removed={props.file.removed} />
      </h2>
      <Show
        when={noteText(props.file)}
        fallback={
          // One scroller per file, so a long line moves only its own file sideways.
          <div class="diff-body">
            <div class="diff-rows">
              <For each={props.file.hunks}>
                {(hunk, i) => (
                  <>
                    <Show when={i() > 0}>
                      <div class="diff-sep" aria-hidden="true" />
                    </Show>
                    <For each={hunk}>
                      {(line) => (
                        <div class="diff-line" data-kind={line.kind}>
                          <span class="ln">{line.oldLine}</span>
                          <span class="ln">{line.newLine}</span>
                          <span class="mk">{MARKER[line.kind]}</span>
                          {/* A blank line holds a newline: an empty span between unselectable ones copies as nothing. */}
                          <span class="code">{line.text || '\n'}</span>
                        </div>
                      )}
                    </For>
                  </>
                )}
              </For>
            </div>
          </div>
        }
      >
        {(text) => (
          <p class="diff-note" data-testid="diff-note">
            {text()}
          </p>
        )}
      </Show>
    </section>
  );
}
