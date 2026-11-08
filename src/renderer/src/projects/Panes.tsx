import { createSignal, For, Show, type JSX } from 'solid-js';
import type { RendererConfig } from '../../../shared/types';
import { dragDivider } from './layout';
import ProjectPane from './ProjectPane';
import { openProject, projectsStore, setLayout, weightOf } from './projectsStore';

/** The narrowest a column of the side-by-side panes is dragged to. */
const MIN_PANE = 360;
/** How far one arrow key moves a divider. */
const KEY_STEP = 16;

/**
 * The open projects' panes: the ones on screen side by side, with dividers to drag, or in a grid.
 * Every open project's pane is mounted; the ones off screen wait, invisible, under these.
 */
export default function Panes(props: {
  config: RendererConfig | undefined;
  managerWidth: number;
  onManagerDrag(w: number): void;
  onManagerDone(w: number, paneWidth: number): void;
  onJump(): void;
}) {
  let root!: HTMLDivElement;
  const layout = () => projectsStore.layout;
  const grid = () => layout().arrangement === 'grid' && layout().shown.length > 1;
  const gridColumns = () => Math.ceil(Math.sqrt(layout().shown.length));

  const paneStyle = (dir: string): JSX.CSSProperties => {
    const at = layout().shown.indexOf(dir);
    if (at < 0) return {};
    // Dividers sit at the odd places between them.
    return grid() ? { order: at * 2 } : { order: at * 2, flex: `${weightOf(dir)} 1 0` };
  };

  /** The divider after the shown pane at `index`: a drag or the arrow keys move it. */
  function Divider(dividerProps: { index: number }) {
    const [dragging, setDragging] = createSignal(false);
    const panesWidth = () => {
      const dividers = layout().shown.length - 1;
      const divider = root.querySelector<HTMLElement>('[data-testid=pane-divider]')?.offsetWidth ?? 0;
      return root.clientWidth - dividers * divider;
    };
    const weights = () => layout().shown.map(weightOf);
    const moveBy = (from: number[], dx: number, keep: boolean) => {
      const next = dragDivider(from, dividerProps.index, dx, panesWidth(), MIN_PANE);
      const weightsByDir = { ...layout().weights };
      layout().shown.forEach((dir, i) => (weightsByDir[dir] = next[i]));
      setLayout({ ...layout(), weights: weightsByDir }, keep);
    };

    // Captured, so the drag goes on when the pointer leaves the divider or the window.
    const startDrag = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const handle = e.currentTarget;
      const from = { x: e.clientX, weights: weights() };
      handle.setPointerCapture(e.pointerId);
      setDragging(true);
      const move = (ev: PointerEvent) => moveBy(from.weights, ev.clientX - from.x, false);
      const end = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('lostpointercapture', end);
        setDragging(false);
        setLayout(layout());
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('lostpointercapture', end);
    };
    const onKey = (e: KeyboardEvent) => {
      const step = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[e.key];
      if (step === undefined) return;
      e.preventDefault();
      moveBy(weights(), step, true);
    };

    return (
      <div
        class="pane-divider"
        data-testid="pane-divider"
        data-dragging={String(dragging())}
        role="separator"
        aria-orientation="vertical"
        aria-label="Width of the projects beside it"
        tabindex="0"
        style={{ order: dividerProps.index * 2 + 1 }}
        onPointerDown={startDrag}
        onKeyDown={onKey}
      />
    );
  }

  return (
    <div
      class="panes"
      data-testid="panes"
      ref={root}
      data-arrangement={grid() ? 'grid' : 'columns'}
      style={grid() ? { 'grid-template-columns': `repeat(${gridColumns()}, minmax(0, 1fr))` } : undefined}
    >
      <For each={projectsStore.projects}>
        {(project) => (
          <ProjectPane
            project={project}
            shown={layout().shown.includes(project.dir)}
            config={props.config}
            style={paneStyle(project.dir)}
            managerWidth={props.managerWidth}
            onManagerDrag={props.onManagerDrag}
            onManagerDone={props.onManagerDone}
            onJump={props.onJump}
          />
        )}
      </For>
      <Show when={!grid()}>
        <For each={layout().shown.slice(0, -1)}>{(_dir, i) => <Divider index={i()} />}</For>
      </Show>
      <Show when={projectsStore.loaded && projectsStore.projects.length === 0}>
        <div class="panes-empty" data-testid="no-project">
          <h2>No project open</h2>
          <p>Open a project folder to see its tasks and its manager here.</p>
          <button class="btn primary" onClick={() => void openProject()}>
            Open project
          </button>
        </div>
      </Show>
    </div>
  );
}
