import { createMemo, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { ProjectView, RendererConfig } from '../../../shared/types';
import Board from '../board/Board';
import { glyphOf, stateLabel } from '../board/lanes';
import NewTaskDialog from '../board/NewTaskDialog';
import StatusGlyph from '../board/StatusGlyph';
import ManagerColumn from '../manager/ManagerColumn';
import { clampManagerWidth } from '../manager/managerPrefs';
import { BOARD_ROOM, loadPanelPrefs, MIN_WIDTH, savePanelPrefs, type PanelPrefs } from '../panel/panelPrefs';
import SessionPanel from '../panel/SessionPanel';
import SidePanel from '../panel/SidePanel';
import { focusTerminalOf, sessionOf, setPanelOpen, tasksOf } from '../tasksStore';
import { ProjectContext } from './projectContext';
import { isFocused, managerHidden, projectsStore, revealProject, toggleManagerOf } from './projectsStore';

// Buttons don't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * One open project: its manager's column, its board and its session panel. Every open project has
 * one mounted, on screen or not, so its terminals keep their output; one off screen is laid out over
 * the others, invisible, at the size of the area the panes share.
 */
export default function ProjectPane(props: {
  project: ProjectView;
  shown: boolean;
  config: RendererConfig | undefined;
  /** Where it sits among the panes on screen. */
  style: JSX.CSSProperties;
  /** The manager column's width: the owner's, for every project. */
  managerWidth: number;
  onManagerDrag(w: number): void;
  onManagerDone(w: number, paneWidth: number): void;
  onJump(): void;
}) {
  const dir = props.project.dir;
  let root!: HTMLDivElement;
  const [width, setWidth] = createSignal(window.innerWidth);
  onMount(() => {
    setWidth(root.clientWidth);
    const observer = new ResizeObserver(() => setWidth(root.clientWidth));
    observer.observe(root);
    onCleanup(() => observer.disconnect());
  });

  const tasks = () => tasksOf(dir);
  const selected = createMemo(() => tasks().tasks.find((t) => t.id === tasks().selectedId));
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const hideManager = () => managerHidden(dir);
  // Framed while the owner works in it beside other projects; alone on screen, it needs no frame.
  const framed = () => props.shown && isFocused(dir) && projectsStore.layout.shown.length > 1;
  // The pane clamps what the column shows, and the session panel leaves it that much.
  const shownManagerWidth = () => clampManagerWidth(props.managerWidth, width());
  const besideWidth = () => (hideManager() ? 0 : shownManagerWidth());
  // Too narrow for the board beside the pinned panel at its narrowest, the panel floats over the board
  // as an unpinned one does. The owner's pin is kept for a pane with room.
  const roomToPin = () => width() - besideWidth() - MIN_WIDTH >= BOARD_ROOM.pinned;
  // The project's own width and pin, so pinning one project's panel leaves the others' as they are.
  const [ownPanelPrefs, setOwnPanelPrefs] = createSignal(loadPanelPrefs(localStorage, dir));
  const panelPrefs = (): PanelPrefs => ({ ...ownPanelPrefs(), pinned: ownPanelPrefs().pinned && roomToPin() });
  const keepPanelPrefs = (prefs: PanelPrefs) => {
    const kept = roomToPin() ? prefs : { ...prefs, pinned: ownPanelPrefs().pinned };
    setOwnPanelPrefs(kept);
    savePanelPrefs(localStorage, dir, kept);
  };
  // Unpinned, a press on the board outside any card puts the panel away.
  const hideUnpinnedPanel = (e: MouseEvent) => {
    if (!panelPrefs().pinned && !(e.target as Element).closest('[data-testid=task-card]')) setPanelOpen(dir, false);
  };
  const closeDialog = () => {
    setDialogOpen(false);
    // The dialog hands the focus back to where it was; the selected task's terminal is where typing goes.
    const id = tasks().selectedId;
    if (id) focusTerminalOf(dir, id);
  };

  return (
    <ProjectContext.Provider value={{ dir, name: props.project.name, shown: () => props.shown, width }}>
      <div
        class="project-pane"
        ref={root}
        data-testid="project-pane"
        data-project={dir}
        data-shown={String(props.shown)}
        data-focused={String(framed())}
        aria-hidden={props.shown ? undefined : 'true'}
        inert={!props.shown}
        style={props.style}
        onPointerDown={() => revealProject(dir)}
        onFocusIn={() => revealProject(dir)}
      >
        <ManagerColumn
          config={props.config}
          width={shownManagerWidth()}
          hidden={hideManager()}
          onDrag={props.onManagerDrag}
          onDone={(w) => props.onManagerDone(w, width())}
        />

        <section class="board-column" aria-label={`Tasks of ${props.project.name}`}>
          <header class="topbar">
            <button class="tb-btn" data-testid="new-task" onMouseDown={keepFocus} onClick={() => setDialogOpen(true)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                <path d="M8 3v10M3 8h10" />
              </svg>
              New task
            </button>
            <span class="tb-project" title={dir}>
              <i aria-hidden="true" />
              <span>{props.project.name}</span>
            </span>
            <button
              class="tb-toggle"
              data-testid="manager-toggle"
              aria-pressed={hideManager() ? 'false' : 'true'}
              title={hideManager() ? 'Show the manager' : 'Hide the manager'}
              onMouseDown={keepFocus}
              onClick={() => toggleManagerOf(dir)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
                <rect x="2" y="3" width="12" height="10" rx="2" />
                <path d="M6.5 3v10" />
              </svg>
              <span>Manager</span>
            </button>
            <button class="tb-jump" data-testid="jump-next" title="Next session that needs you" onMouseDown={keepFocus} onClick={props.onJump}>
              <kbd>Ctrl</kbd>
              <kbd>Tab</kbd>
              <span>Next that needs you</span>
            </button>
          </header>
          <div class="board" data-testid="board" onMouseDown={hideUnpinnedPanel}>
            <Board />
          </div>
        </section>

        <SidePanel
          label="Selected session"
          prefs={panelPrefs()}
          onPrefsChange={keepPanelPrefs}
          canPin={roomToPin()}
          besideWidth={besideWidth()}
          open={tasks().panelOpen}
          onOpenChange={(open) => setPanelOpen(dir, open)}
          badge={
            <Show when={selected()}>
              {(task) => <StatusGlyph glyph={glyphOf(task(), sessionOf(task()))} label={stateLabel(task(), sessionOf(task())).text} />}
            </Show>
          }
          badgeLabel={selected() ? stateLabel(selected()!, sessionOf(selected()!)).text : undefined}
          empty={
            selected() ? undefined : (
              <>
                <strong>Select a session on the board</strong>
                New task starts Claude Code in a worktree of its own.
              </>
            )
          }
        >
          <SessionPanel task={selected()} config={props.config} />
        </SidePanel>

        <Show when={dialogOpen()}>
          <NewTaskDialog onClose={closeDialog} />
        </Show>
      </div>
    </ProjectContext.Provider>
  );
}
