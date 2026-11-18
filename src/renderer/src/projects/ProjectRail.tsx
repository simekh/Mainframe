import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from 'solid-js';
import PanelStrip, { createFoldHandOff, FoldButton } from '../panel/PanelStrip';
import { needsYouCount } from '../tasksStore';
import {
  closeProject,
  focusProject,
  isFocused,
  isShown,
  moveProjectTo,
  offScreenNeedsYou,
  openProject,
  projectsStore,
  railState,
  setArrangement,
  setRailState,
  toggleBesideProject,
} from './projectsStore';
import { dropIndex, shiftOf } from './railOrder';

// The buttons don't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** How far a press on a row moves before it is a drag and no longer a click. */
const DRAG_THRESHOLD = 4;

/** A row being dragged: where it was and where it would land, how far it has moved, and how far the others slide. */
interface Drag {
  dir: string;
  from: number;
  to: number;
  dy: number;
  slot: number;
}

/** Swallows the click that ends a drag, wherever the pointer was let go, so it focuses nothing. */
function swallowClick(): void {
  const swallow = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  // A drag let go off any element gets no click, and the next real one must not be lost.
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }));
}

/**
 * The open projects, an island at the window's left under the top row, there while Projects has it on. A click
 * focuses a project, on screen in the focused one's place if it was off it; Show beside adds it to the ones on screen.
 * Each says how many of its sessions need the owner, so one off screen still shows when it waits on them. A row dragged
 * up or down, or moved with Alt+Up and Alt+Down, puts its project in a new place in the list. Folded, the
 * list is a strip in its place that counts the sessions waiting in the projects off screen, and opens it again.
 */
export default function ProjectRail() {
  /** The project whose close waits for the owner to confirm it. */
  const [confirming, setConfirming] = createSignal<string | null>(null);
  const [drag, setDrag] = createSignal<Drag | null>(null);
  /** Ends the press under way, if any, without moving its project. */
  let letGo: (() => void) | undefined;
  // The list going, or a project opening or closing, leaves nothing the drag measured true.
  createEffect(on([railState, () => projectsStore.projects.map((p) => p.dir).join('\n')], () => letGo?.(), { defer: true }));

  /**
   * A press on a row, past the threshold, drags it along the list, kept within it; the others slide to make room, and
   * letting go moves the project there. Not from the row's own buttons, nor from its close question.
   */
  const pressRow = (e: PointerEvent & { currentTarget: HTMLLIElement }, dir: string) => {
    if (e.button !== 0 || (e.target as Element).closest('.rail-act, .rail-confirm')) return;
    // One whose pointerup went astray.
    letGo?.();
    const list = e.currentTarget.parentElement!;
    const startY = e.clientY;
    // Only once the press is a drag: a plain click needs none of it.
    const measure = () => {
      const from = projectsStore.projects.findIndex((p) => p.dir === dir);
      const rows = [...list.children].map((el) => el.getBoundingClientRect());
      const own = rows[from];
      return {
        from,
        mids: rows.map((r) => r.top + r.height / 2),
        slot: own.height + (parseFloat(getComputedStyle(list).rowGap) || 0),
        min: rows[0].top - own.top,
        max: rows[rows.length - 1].bottom - own.bottom,
      };
    };
    let measured: ReturnType<typeof measure> | undefined;
    // On the window, not captured: a capture would take the click of a short press away from the row's button.
    const move = (ev: PointerEvent) => {
      // Its pointerup went astray.
      if ((ev.buttons & 1) === 0) return stop();
      if (measured === undefined && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
      measured ??= measure();
      const { from, mids, slot, min, max } = measured;
      const dy = Math.min(Math.max(ev.clientY - startY, min), max);
      setDrag({ dir, from, to: dropIndex(mids, from, mids[from] + dy), dy, slot });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', stop);
      letGo = undefined;
      setDrag(null);
    };
    const drop = () => {
      const done = drag();
      stop();
      if (done === null) return;
      swallowClick();
      moveProjectTo(done.dir, done.to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', stop);
    letGo = stop;
  };
  const several = () => projectsStore.layout.shown.length > 1;
  // Only the strip shows it.
  const waiting = createMemo(() => (railState() === 'folded' ? offScreenNeedsYou() : 0));
  const handOff = createFoldHandOff('Fold the projects list', () => railState() === 'open', (open) =>
    setRailState(open ? 'open' : 'folded'),
  );

  return (
    <Switch>
      <Match when={railState() === 'folded'}>
        <PanelStrip
          class="rail-strip"
          name="Projects"
          label="Show projects"
          status={waiting() > 0 ? `${waiting()} need you` : undefined}
          side="left"
          mark={
            <Show when={waiting() > 0}>
              <span class="rail-count">{waiting()}</span>
            </Show>
          }
          testId="rail-strip"
          handOff={handOff}
        />
      </Match>
      <Match when={railState() === 'open'}>
        <nav class="rail" data-testid="project-rail" aria-label="Projects">
          <header class="rail-header">
            <h2 class="p-title">Projects</h2>
            <div class="rail-arrange" role="group" aria-label="Projects on screen">
              <button
                data-testid="arrange-columns"
                aria-pressed={projectsStore.layout.arrangement === 'columns' ? 'true' : 'false'}
                title="Side by side"
                onMouseDown={keepFocus}
                onClick={() => setArrangement('columns')}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
                  <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
                  <path d="M8 2.75v10.5" />
                </svg>
              </button>
              <button
                data-testid="arrange-grid"
                aria-pressed={projectsStore.layout.arrangement === 'grid' ? 'true' : 'false'}
                title="Grid"
                onMouseDown={keepFocus}
                onClick={() => setArrangement('grid')}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
                  <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
                  <path d="M8 2.75v10.5M1.75 8h12.5" />
                </svg>
              </button>
            </div>
            <FoldButton points="left" testId="rail-fold" handOff={handOff} />
          </header>

          <ul class="rail-list" data-dragging={String(drag() !== null)}>
            <For each={projectsStore.projects}>
              {(project, index) => {
                const count = createMemo(() => needsYouCount(project.dir));
                // On screen beside others, so its button takes it off; the last one on screen stays.
                const beside = () => isShown(project.dir) && several();
                const dragged = () => drag()?.dir === project.dir;
                const offset = () => {
                  const d = drag();
                  if (d === null) return 0;
                  return dragged() ? d.dy : shiftOf(index(), d.from, d.to) * d.slot;
                };
                return (
                  <li
                    class="rail-item"
                    data-testid="rail-project"
                    data-project={project.dir}
                    data-shown={String(isShown(project.dir))}
                    data-focused={String(isFocused(project.dir))}
                    data-dragging={String(dragged())}
                    style={{ transform: offset() === 0 ? undefined : `translateY(${offset()}px)` }}
                    onPointerDown={(e) => pressRow(e, project.dir)}
                  >
                    <Show
                      when={confirming() === project.dir}
                      fallback={
                        <>
                          <button
                            class="rail-name"
                            data-testid="rail-show"
                            title={project.dir}
                            aria-current={isFocused(project.dir) ? 'true' : undefined}
                            onMouseDown={keepFocus}
                            onClick={() => focusProject(project.dir)}
                            onKeyDown={(e) => {
                              const step = { ArrowUp: -1, ArrowDown: 1 }[e.key];
                              if (step === undefined || !e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
                              e.preventDefault();
                              const button = e.currentTarget;
                              moveProjectTo(project.dir, index() + step);
                              // Moving its row drops the focus from it.
                              queueMicrotask(() => button.focus());
                            }}
                          >
                            <i aria-hidden="true" />
                            <span class="rail-label">{project.name}</span>
                            <Show when={count() > 0}>
                              <span class="rail-count" data-testid="rail-count" aria-label={`${count()} need you`}>
                                {count()}
                              </span>
                            </Show>
                          </button>
                          <button
                            class="rail-act"
                            data-testid="rail-beside"
                            aria-pressed={beside() ? 'true' : 'false'}
                            aria-label={`Show ${project.name} beside the others`}
                            title={beside() ? 'Take off screen' : 'Show beside'}
                            disabled={isShown(project.dir) && !beside()}
                            onMouseDown={keepFocus}
                            onClick={() => toggleBesideProject(project.dir)}
                          >
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
                              <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
                              <path d="M8 2.75v10.5" />
                              <path d="M11 6.5v3M9.5 8h3" stroke-linecap="round" />
                            </svg>
                          </button>
                          <button
                            class="rail-act"
                            data-testid="rail-close"
                            aria-label={`Close ${project.name}`}
                            title="Close project"
                            onMouseDown={keepFocus}
                            onClick={() => setConfirming(project.dir)}
                          >
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                            </svg>
                          </button>
                        </>
                      }
                    >
                      <div class="rail-confirm" role="group" aria-label={`Close ${project.name}?`}>
                        <p>
                          Close {project.name}? Its sessions stop, and carry on when you open it again.
                        </p>
                        <div class="rail-confirm-actions">
                          <button
                            class="btn"
                            data-testid="rail-close-confirm"
                            onClick={() => {
                              setConfirming(null);
                              closeProject(project.dir);
                            }}
                          >
                            Close
                          </button>
                          <button class="btn" onClick={() => setConfirming(null)}>
                            Keep open
                          </button>
                        </div>
                      </div>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>

          <button class="rail-open" data-testid="open-project" onMouseDown={keepFocus} onClick={() => void openProject()}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
              <path d="M8 3v10M3 8h10" />
            </svg>
            Open project
          </button>
        </nav>
      </Match>
    </Switch>
  );
}
