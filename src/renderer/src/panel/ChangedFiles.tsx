// Adapted from Parallel Code (MIT): src/components/ChangedFilesList.tsx (its polling) at 97c3558. See THIRD_PARTY_NOTICES.md.
import { createEffect, createSignal, Index, on, onCleanup } from 'solid-js';
import type { ChangedFile } from '../../../shared/types';
import FileRowContent from '../diff/FileRowContent';
import LineCounts from '../diff/LineCounts';
import { useProject } from '../projects/projectContext';

const POLL_MS = 5_000;

// The heading and the rows don't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** What the selected task changed in its worktree, refreshed while it stays selected. */
export default function ChangedFiles(props: { taskId: string | null; running: boolean }) {
  const project = useProject();
  // By task: a task selected again shows its last list at once rather than an empty pane.
  const [known, setKnown] = createSignal<Record<string, ChangedFile[] | null>>({});
  // Tasks git has found a worktree for during this run. No worktree before that, while the session
  // runs, means claude hasn't made it yet; after it, that the worktree went away.
  const [seen, setSeen] = createSignal<ReadonlySet<string>>(new Set());
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
          window.mainframe
            .changedFiles(project.dir, taskId)
            .then((files) => {
              if (cancelled) return;
              setKnown((all) => ({ ...all, [taskId]: files }));
              if (files !== null && !seen().has(taskId)) setSeen((all) => new Set(all).add(taskId));
            })
            .catch((err: unknown) => console.warn(`[files] could not list the changes of task ${taskId}`, err))
            .finally(() => {
              inFlight = false;
            });
        };
        // Every 5 s while the window and the project's pane show, and at once when the window shows again.
        const refreshIfVisible = () => {
          if (document.visibilityState === 'visible' && project.shown()) refresh();
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
  const notMadeYet = () => props.running && !seen().has(props.taskId!);
  const count = () => files()?.length ?? 0;
  const total = (key: 'added' | 'removed') => (files() ?? []).reduce((sum, f) => sum + (f[key] ?? 0), 0);
  const label = () => {
    const list = files();
    if (list === undefined) return '';
    if (list === null) return notMadeYet() ? 'No changes yet' : 'Worktree removed';
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
        <LineCounts added={total('added')} removed={total('removed')} />
      </button>
      <ul class="file-list" id="changed-file-list" aria-label="Changed files" hidden={!open() || count() === 0}>
        <Index each={files() ?? []}>
          {(file) => (
            <li data-testid="changed-file" data-status={file().status}>
              <button
                class="file-row"
                onMouseDown={keepFocus}
                onClick={() => {
                  const { path } = file();
                  window.mainframe
                    .openDiff(project.dir, props.taskId!, path)
                    .catch((err: unknown) => console.warn(`[diff] could not open the changes of ${path}`, err));
                }}
              >
                <FileRowContent file={file()} />
              </button>
            </li>
          )}
        </Index>
      </ul>
    </section>
  );
}
