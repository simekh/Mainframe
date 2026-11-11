import { createMemo, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { ProjectView, RendererConfig } from '../../../shared/types';
import Board from '../board/Board';
import { glyphOf, stateLabel } from '../board/lanes';
import NewTaskDialog from '../board/NewTaskDialog';
import StatusGlyph from '../board/StatusGlyph';
import ManagerColumn from '../manager/ManagerColumn';
import {
  clampManagerWidth, loadManagerPinned, loadManagerWidth, saveManagerPinned, saveManagerWidth,
} from '../manager/managerPrefs';
import { managerStateOf } from '../manager/managerStore';
import { loadPanelPrefs, roomTaken, roomToPin, savePanelPrefs, STRIP_WIDTH, type PanelPrefs, type PanelState } from '../panel/panelPrefs';
import SessionPanel from '../panel/SessionPanel';
import SidePanel from '../panel/SidePanel';
import { focusTerminalOf, sessionOf, setPanelOpen, tasksOf } from '../tasksStore';
import TodoPanel from '../todo/TodoPanel';
import { clampTodoWidth, loadTodoPrefs, saveTodoPrefs } from '../todo/todoPrefs';
import { ProjectContext } from './projectContext';
import {
  isFocused, isManagerShown, isShown, jump, managerOpenOf, projectsStore, revealProject, setManagerOpen, toggleManagerOf,
} from './projectsStore';

// Buttons don't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

// The owner's width for the managers' columns, one for every project. Each pane clamps what it shows,
// and its session panel leaves it that much.
const [managerWidth, setManagerWidth] = createSignal(loadManagerWidth(localStorage));

/**
 * One open project: its manager's column, its board and its session panel. Every open project has
 * one mounted, on screen or not, so its terminals keep their output; one off screen is laid out over
 * the others, invisible, at the size of the area the panes share.
 */
export default function ProjectPane(props: {
  project: ProjectView;
  config: RendererConfig | undefined;
  /** Where it sits among the panes on screen. */
  style: JSX.CSSProperties;
}) {
  const dir = props.project.dir;
  const shown = () => isShown(dir);
  let root!: HTMLDivElement;
  // The pane's own width, never the window's: measured as it mounts, before the first paint.
  const [width, setWidth] = createSignal(0);
  onMount(() => {
    setWidth(root.clientWidth);
    const observer = new ResizeObserver(() => setWidth(root.clientWidth));
    observer.observe(root);
    onCleanup(() => observer.disconnect());
  });

  const tasks = () => tasksOf(dir);
  const selected = createMemo(() => tasks().tasks.find((t) => t.id === tasks().selectedId));
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const showManager = () => isManagerShown(dir);
  // Framed while the owner works in it beside other projects; alone on screen, it needs no frame.
  const framed = () => isFocused(dir) && projectsStore.layout.shown.length > 1;
  // The width while the edge is dragged, this pane's alone: the others take the one kept once the
  // pointer lets go, rather than laying themselves out at every move.
  const [dragManagerWidth, setDragManagerWidth] = createSignal<number | null>(null);
  // The project's own pin, as the panel's is. Unpinned, the manager floats over the board and takes no room.
  const [managerPinned, setManagerPinned] = createSignal(loadManagerPinned(localStorage, dir));
  const keepManagerPinned = (pinned: boolean) => {
    setManagerPinned(pinned);
    saveManagerPinned(localStorage, dir, pinned);
  };
  // Until the owner first folds or opens it, the manager that is on is as its pin shows it: open pinned, folded floating.
  const managerState = (): PanelState => {
    if (!showManager()) return 'off';
    return (managerOpenOf(dir) ?? managerPinned()) ? 'open' : 'folded';
  };
  let managerToggle!: HTMLButtonElement;
  // Turned off with the focus in it or on its strip, the manager hands the focus to its button, so the keyboard never
  // ends up in it, or nowhere.
  const toggleManager = () => {
    const handBack =
      showManager() && [...root.querySelectorAll('.manager-column, .manager-strip')].some((el) => el.contains(document.activeElement));
    toggleManagerOf(dir);
    if (handBack) managerToggle.focus();
  };

  // The Todo panel's own width and pin; pinned, it is out from the start, and unpinned it waits for the Todo button.
  const [todoPrefs, setTodoPrefs] = createSignal(loadTodoPrefs(localStorage, dir));
  const [todoOpen, setTodoOpen] = createSignal(todoPrefs().pinned);
  const [dragTodoWidth, setDragTodoWidth] = createSignal<number | null>(null);
  const keepTodoPrefs = (prefs: PanelPrefs) => {
    setTodoPrefs(prefs);
    saveTodoPrefs(localStorage, dir, prefs);
  };
  // Floating, the Todo panel takes no room and the pane is all it measures against. Pinned, it leaves room for the
  // floating manager's strip, or for the pinned manager as wide as that would be alone, and the manager takes what is
  // left: where both can't have their width, the Todo panel gives way first. Folded, the pinned manager keeps that
  // room, which the board takes meanwhile, so it folds and opens where it stands, at its width; off, it frees it.
  const todoRoom = () => {
    if (!todoPrefs().pinned || !showManager()) return width();
    return width() - (managerPinned() ? clampManagerWidth(dragManagerWidth() ?? managerWidth(), width()) : STRIP_WIDTH);
  };
  const todoWidthIn = (w: number) => clampTodoWidth(w, todoRoom(), todoPrefs().pinned);
  const shownTodoWidth = () => todoWidthIn(dragTodoWidth() ?? todoPrefs().width);
  const keepTodoWidth = (w: number) => {
    setDragTodoWidth(null);
    keepTodoPrefs({ ...todoPrefs(), width: todoWidthIn(w) });
  };
  const todoBeside = () => (todoOpen() && todoPrefs().pinned ? shownTodoWidth() : 0);
  // The ticket open beside the Todo panel: an item's key, or 'new-note'. It goes with the panel.
  const [ticket, setTicket] = createSignal<string | null>(null);
  const showTodo = (open: boolean) => {
    setTodoOpen(open);
    if (!open) setTicket(null);
  };
  let todoToggle!: HTMLButtonElement;
  // Its hide arrow hands the focus to the Todo button, so the keyboard never ends up in a hidden panel.
  const hideTodo = () => {
    showTodo(false);
    todoToggle.focus();
  };

  // What the pinned Todo panel leaves of the pane is all the manager measures against, less its own strip while it
  // floats: pinned, a fold keeps its width.
  const managerWidthIn = (w: number) => clampManagerWidth(w, width() - todoBeside() - (managerPinned() ? 0 : STRIP_WIDTH));
  const shownManagerWidth = () => managerWidthIn(dragManagerWidth() ?? managerWidth());
  const keepManagerWidth = (w: number) => {
    setDragManagerWidth(null);
    const kept = managerWidthIn(w);
    setManagerWidth(kept);
    saveManagerWidth(localStorage, kept);
  };
  const besideWidth = () => roomTaken(managerState(), managerPinned(), shownManagerWidth()) + todoBeside();
  // Too narrow for the board beside the pinned panel at its narrowest, the panel floats over the board
  // as an unpinned one does. The owner's pin is kept for a pane with room.
  const canPinPanel = () => roomToPin(width(), besideWidth());
  // The project's own width and pin, so pinning one project's panel leaves the others' as they are.
  const [ownPanelPrefs, setOwnPanelPrefs] = createSignal(loadPanelPrefs(localStorage, dir));
  const panelPrefs = (): PanelPrefs => ({ ...ownPanelPrefs(), pinned: ownPanelPrefs().pinned && canPinPanel() });
  // Until the owner first folds or opens it, the panel is as its pin shows it: open pinned, folded floating.
  const panelOpen = () => tasks().panelOpen ?? panelPrefs().pinned;
  const keepPanelPrefs = (prefs: PanelPrefs) => {
    const kept = canPinPanel() ? prefs : { ...prefs, pinned: ownPanelPrefs().pinned };
    setOwnPanelPrefs(kept);
    savePanelPrefs(localStorage, dir, kept);
  };
  // A press on the board outside any card puts away the panel and the manager (into their strips) and the Todo panel
  // that float over it, and the ticket, pinned panel or not. A manager that is off stays off.
  const hideUnpinned = (e: MouseEvent) => {
    if ((e.target as Element).closest('[data-testid=task-card]')) return;
    if (!panelPrefs().pinned) setPanelOpen(dir, false);
    if (!managerPinned()) setManagerOpen(dir, false);
    if (!todoPrefs().pinned) setTodoOpen(false);
    setTicket(null);
  };
  const closeDialog = () => {
    setDialogOpen(false);
    // The dialog hands the focus back to where it was; the selected task's terminal is where typing goes.
    const id = tasks().selectedId;
    if (id) focusTerminalOf(dir, id);
  };

  return (
    <ProjectContext.Provider value={{ dir, name: props.project.name, shown, width }}>
      <div
        class="project-pane"
        ref={root}
        data-testid="project-pane"
        data-project={dir}
        data-shown={String(shown())}
        data-focused={String(framed())}
        aria-hidden={shown() ? undefined : 'true'}
        inert={!shown()}
        // What the pinned Todo panel takes at the pane's left, its margin with it: the manager, floating or folded, sits right of it.
        style={{ ...props.style, '--left-room': `${todoBeside() ? todoBeside() + 8 : 0}px` }}
        onPointerDown={() => revealProject(dir)}
        onFocusIn={() => revealProject(dir)}
      >
        <section class="board-column" aria-label={`Tasks of ${props.project.name}`}>
          <header class="topbar">
            <span class="tb-project" title={dir}>
              <i aria-hidden="true" />
              <span>{props.project.name}</span>
            </span>
            <button class="tb-btn" data-testid="new-task" onMouseDown={keepFocus} onClick={() => setDialogOpen(true)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                <path d="M8 3v10M3 8h10" />
              </svg>
              New task
            </button>
            <button
              class="tb-toggle"
              data-testid="todo-toggle"
              ref={todoToggle}
              aria-pressed={todoOpen() ? 'true' : 'false'}
              title={todoOpen() ? 'Hide the Todo panel' : 'Show the Todo panel'}
              onMouseDown={keepFocus}
              onClick={() => showTodo(!todoOpen())}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
                <path d="M6 4.5h7.5M6 8h7.5M6 11.5h7.5" />
                <path d="M2.75 4.5h.01M2.75 8h.01M2.75 11.5h.01" stroke-width="2" />
              </svg>
              <span>Todo</span>
            </button>
            <button
              class="tb-toggle"
              data-testid="manager-toggle"
              ref={managerToggle}
              aria-pressed={showManager() ? 'true' : 'false'}
              title={showManager() ? 'Hide the manager' : 'Show the manager'}
              onMouseDown={keepFocus}
              onClick={toggleManager}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
                <rect x="2" y="3" width="12" height="10" rx="2" />
                <path d="M6.5 3v10" />
              </svg>
              <span>Manager</span>
              {/* Off, it still shows the manager's state, so a manager waiting for the owner shows from here. */}
              <Show when={showManager() ? undefined : managerStateOf(dir)}>
                {(s) => <StatusGlyph glyph={s().glyph} label={s().text} />}
              </Show>
            </button>
            <button class="tb-jump" data-testid="jump-next" title="Next session that needs you" onMouseDown={keepFocus} onClick={() => jump(1)}>
              <kbd>Ctrl</kbd>
              <kbd>Tab</kbd>
              <span>Next that needs you</span>
            </button>
          </header>
          <div class="board" data-testid="board" onMouseDown={hideUnpinned}>
            <Board />
          </div>
        </section>

        {/* Laid out left of the board, and before the Todo panel in the page: macOS carves a drag region
            only for what comes after it, and that panel floats over this column's title bar. */}
        <ManagerColumn
          config={props.config}
          width={shownManagerWidth()}
          maxWidth={managerWidthIn(Infinity)}
          onDrag={setDragManagerWidth}
          onDone={keepManagerWidth}
          pinned={managerPinned()}
          onPinnedChange={keepManagerPinned}
          state={managerState()}
          onOpenChange={(open) => setManagerOpen(dir, open)}
        />

        {/* After the manager and the board, for that reason: it floats over the manager's title bar, and its
            ticket over the top bar. */}
        <TodoPanel
          width={shownTodoWidth()}
          maxWidth={todoWidthIn(Infinity)}
          onDrag={setDragTodoWidth}
          onDone={keepTodoWidth}
          pinned={todoPrefs().pinned}
          onPinnedChange={(pinned) => keepTodoPrefs({ ...todoPrefs(), pinned })}
          open={todoOpen()}
          onHide={hideTodo}
          ticket={ticket()}
          onTicketChange={setTicket}
        />

        <SidePanel
          label="Selected session"
          prefs={panelPrefs()}
          onPrefsChange={keepPanelPrefs}
          canPin={canPinPanel()}
          // Its own strip counts only while it floats: pinned, a fold keeps its width.
          besideWidth={besideWidth() + (panelPrefs().pinned ? 0 : STRIP_WIDTH)}
          open={panelOpen()}
          onOpenChange={(open) => setPanelOpen(dir, open)}
          stripName={selected()?.title ?? 'Session'}
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
