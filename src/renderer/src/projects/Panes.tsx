import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { RendererConfig } from '../../../shared/types';
import ResizeEdge from '../panel/ResizeEdge';
import { columnsOf, dragDivider, growOf, panePlace, paneWeight } from './layout';
import ProjectPane from './ProjectPane';
import { openProject, projectsStore, setLayout } from './projectsStore';

/** The narrowest a column of the side-by-side panes is dragged to. */
const MIN_PANE = 360;

/**
 * The open projects' panes: the ones on screen side by side, with dividers to drag, or in a grid.
 * Every open project's pane is mounted; the ones off screen wait, invisible, under these.
 */
export default function Panes(props: { config: RendererConfig | undefined }) {
  let root!: HTMLDivElement;
  // The dividers take no room of their own, so the panes side by side share all of it.
  const [width, setWidth] = createSignal(0);
  onMount(() => {
    const observer = new ResizeObserver(() => setWidth(root.clientWidth));
    observer.observe(root);
    onCleanup(() => observer.disconnect());
  });
  const layout = () => projectsStore.layout;
  const grid = () => layout().arrangement === 'grid' && layout().shown.length > 1;

  const paneStyle = (dir: string): JSX.CSSProperties => {
    const at = layout().shown.indexOf(dir);
    if (at < 0) return {};
    // Dividers sit at the odd places between them.
    return grid() ? { order: at * 2 } : { order: at * 2, flex: `${growOf(layout(), dir)} 1 0` };
  };

  /** The divider after the shown pane at `index`: that pane's edge, which a drag or the arrow keys move. */
  function Divider(dividerProps: { index: number }) {
    const weights = () => layout().shown.map((dir) => paneWeight(layout(), dir));
    const widthOf = (i: number) => growOf(layout(), layout().shown[i]) * width();
    const left = () => widthOf(dividerProps.index);
    const moveTo = (w: number, keep: boolean) => {
      const next = dragDivider(weights(), dividerProps.index, w - left(), width(), MIN_PANE);
      const weightsByDir = { ...layout().weights };
      layout().shown.forEach((dir, i) => (weightsByDir[dir] = next[i]));
      setLayout({ ...layout(), weights: weightsByDir }, keep);
    };

    return (
      <div class="pane-divider" style={{ order: dividerProps.index * 2 + 1 }}>
        <ResizeEdge
          width={Math.round(left())}
          onDrag={(w) => moveTo(w, false)}
          onDone={(w) => moveTo(w, true)}
          grows="right"
          label="Width of the projects beside it"
          testId="pane-divider"
          min={MIN_PANE}
          max={Math.round(left() + widthOf(dividerProps.index + 1) - MIN_PANE)}
        />
      </div>
    );
  }

  return (
    <div
      class="panes"
      data-testid="panes"
      ref={root}
      data-arrangement={grid() ? 'grid' : 'columns'}
      style={grid() ? { 'grid-template-columns': `repeat(${columnsOf(layout())}, minmax(0, 1fr))` } : undefined}
    >
      <For each={projectsStore.projects}>
        {(project) => (
          <ProjectPane
            project={project}
            config={props.config}
            place={panePlace(layout(), project.dir)}
            style={paneStyle(project.dir)}
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
