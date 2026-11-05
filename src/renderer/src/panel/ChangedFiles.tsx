// Adapted from Parallel Code (MIT): src/components/ChangedFilesList.tsx (its polling) at 97c3558. See THIRD_PARTY_NOTICES.md.
import { createEffect, createSignal, Index, on, onCleanup, Show } from 'solid-js';
import type { ChangedFile } from '../../../shared/types';

const POLL_MS = 5_000;

// The heading doesn't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** Untracked files read as U, as in Parallel Code. */
const letter = (status: ChangedFile['status']) => (status === '?' ? 'U' : status);

/** Line counts; a count that is zero or that git doesn't give shows nothing. */
function Diff(props: { added: number | null; removed: number | null }) {
  return (
    <span class="diff">
      <Show when={props.added}>{(n) => <span class="add">+{n()}</span>}</Show>
      <Show when={props.removed}>{(n) => <span class="rem">−{n()}</span>}</Show>
    </span>
  );
}

/** What the selected task changed in its worktree, refreshed while it stays selected. */
export default function ChangedFiles(props: { taskId: string | null }) {
  // By task: a task selected again shows its last list at once rather than an empty pane.
  const [known, setKnown] = createSignal<Record<string, ChangedFile[] | null>>({});
  // One for the panel, open at first; not kept across starts.
  const [open, setOpen] = createSignal(true);

  createEffect(
    on(
      () => props.taskId,
      (taskId) => {
        if (!taskId) return;
        // Set once the task is no longer selected: a slow answer then never shows under another.
        let cancelled = false;
        let inFlight = false;
        const refresh = () => {
          if (inFlight) return;
          inFlight = true;
          window.thesource
            .changedFiles(taskId)
            .then((files) => {
              if (!cancelled) setKnown((all) => ({ ...all, [taskId]: files }));
            })
            .catch((err: unknown) => console.warn(`[files] could not list the changes of task ${taskId}`, err))
            .finally(() => {
              inFlight = false;
            });
        };
        // Every 5 s while the window shows, and at once when it shows again.
        const refreshIfVisible = () => {
          if (document.visibilityState === 'visible') refresh();
        };
        const timer = setInterval(refreshIfVisible, POLL_MS);
        document.addEventListener('visibilitychange', refreshIfVisible);
        refresh();
        onCleanup(() => {
          cancelled = true;
          clearInterval(timer);
          document.removeEventListener('visibilitychange', refreshIfVisible);
        });
      },
    ),
  );

  /** Undefined until git has answered for the task; null when it found no worktree. */
  const files = () => (props.taskId ? known()[props.taskId] : undefined);
  const count = () => files()?.length ?? 0;
  const total = (key: 'added' | 'removed') => (files() ?? []).reduce((sum, f) => sum + (f[key] ?? 0), 0);
  const label = () => {
    const list = files();
    if (list === undefined) return '';
    if (list === null) return 'Worktree removed';
    if (list.length === 0) return 'No changes yet';
    return `${list.length} ${list.length === 1 ? 'file' : 'files'} changed`;
  };

  return (
    <section class="p-files" data-testid="changed-files" data-count={files() === undefined ? undefined : count()}>
      <button
        class="pane-heading"
        aria-expanded={count() > 0 && open() ? 'true' : 'false'}
        aria-controls="changed-file-list"
        disabled={count() === 0}
        onMouseDown={keepFocus}
        onClick={() => setOpen(!open())}
      >
        <svg
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M3.5 2 6.5 5l-3 3" />
        </svg>
        <span class="label">{label()}</span>
        <Diff added={total('added')} removed={total('removed')} />
      </button>
      <ul class="file-list" id="changed-file-list" hidden={!open() || count() === 0}>
        <Index each={files() ?? []}>
          {(file) => (
            <li data-testid="changed-file" data-status={file().status}>
              <span class="st" data-st={file().status}>
                {letter(file().status)}
              </span>
              <span class="path" title={file().path}>
                <span>{file().path}</span>
              </span>
              <Diff added={file().added} removed={file().removed} />
            </li>
          )}
        </Index>
      </ul>
    </section>
  );
}
