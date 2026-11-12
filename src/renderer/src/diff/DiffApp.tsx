import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { DiffView } from '../../../shared/types';
import { commandHeld, shortcutLetter } from '../keys';
import { resultMessage } from './diffText';
import DiffFile from './DiffFile';
import FileRowContent from './FileRowContent';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/jetbrains-mono/400.css';
// The file list's status letters are bold, as in the panel.
import '@fontsource/jetbrains-mono/700.css';
import '../app.css';
import './diff.css';

/** The diff window's page: the task's changed files on the left, and every file's changes in one scroll on the right. */
export default function DiffApp() {
  const [view, setView] = createSignal<DiffView | null>(null);
  const [selected, setSelected] = createSignal<string | null>(null);
  let scroller: HTMLDivElement | undefined;

  const files = () => {
    const result = view()?.result;
    return result?.kind === 'files' ? result.files : [];
  };
  const message = () => {
    const current = view();
    return current ? resultMessage(current.result) : null;
  };

  const scrollTo = (path: string) =>
    scroller
      ?.querySelector(`[data-testid="diff-file"][data-path="${CSS.escape(path)}"]`)
      ?.scrollIntoView({ block: 'start' });

  const select = (path: string) => {
    setSelected(path);
    scrollTo(path);
  };

  // A view that arrives after a later one (a slow read for an earlier click) is dropped.
  const apply = (next: DiffView) => {
    if (next.seq <= (view()?.seq ?? -Infinity)) return;
    setView(next);
    setSelected(next.focus);
    requestAnimationFrame(() => scrollTo(next.focus));
  };

  onMount(() => {
    // Subscribed before asking, so a view sent in between isn't missed.
    const off = window.mainframe.onDiff(apply);
    window.mainframe
      .getDiff()
      .then((current) => current && apply(current))
      .catch((err: unknown) => console.warn('[diff] could not get the view', err));
    const platform = window.mainframe.platform;
    const onKey = (e: KeyboardEvent) => {
      const esc = e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
      // Cmd+W, or Ctrl+W off the Mac: no terminal here takes it, as one does in Mainframe's window.
      const closeKey = commandHeld(e, platform) && !e.shiftKey && shortcutLetter(e) === 'w';
      if (esc || closeKey) window.mainframe.closeDiff();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => {
      off();
      window.removeEventListener('keydown', onKey);
    });
  });

  return (
    <main class="diff-page">
      <Show
        when={message()}
        fallback={
          <>
            <ul class="file-list diff-list" aria-label="Changed files">
              <For each={files()}>
                {(file) => (
                  <li>
                    <button
                      class="file-row"
                      data-testid="diff-list-row"
                      data-path={file.path}
                      aria-current={selected() === file.path ? 'true' : undefined}
                      onClick={() => select(file.path)}
                    >
                      <FileRowContent file={file} />
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <div class="diff-files" ref={scroller}>
              <For each={files()}>{(file) => <DiffFile file={file} />}</For>
            </div>
          </>
        }
      >
        {(text) => (
          <p class="diff-message" data-testid="diff-message">
            {text()}
          </p>
        )}
      </Show>
    </main>
  );
}
