import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import PanelStrip, { createFoldHandOff, FoldButton } from '../panel/PanelStrip';
import { needsYouCount } from '../tasksStore';
import {
  closeProject,
  focusProject,
  isFocused,
  isShown,
  offScreenNeedsYou,
  openProject,
  projectsStore,
  railState,
  setArrangement,
  setRailState,
  toggleBesideProject,
} from './projectsStore';

// The buttons don't take focus on click, so typing stays in the terminal.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * The open projects, an island at the window's left under the top row, there while Projects has it on. A click
 * focuses a project, on screen in the focused one's place if it was off it; Show beside adds it to the ones on screen.
 * Each says how many of its sessions need the owner, so one off screen still shows when it waits on them. Folded, the
 * list is a strip in its place that counts the sessions waiting in the projects off screen, and opens it again.
 */
export default function ProjectRail() {
  /** The project whose close waits for the owner to confirm it. */
  const [confirming, setConfirming] = createSignal<string | null>(null);
  const several = () => projectsStore.layout.shown.length > 1;
  // Only the strip shows it.
  const waiting = createMemo(() => (railState() === 'folded' ? offScreenNeedsYou() : 0));
  const handOff = createFoldHandOff((open) => setRailState(open ? 'open' : 'folded'));

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
            <FoldButton label="Fold the projects list" points="left" testId="rail-fold" handOff={handOff} />
          </header>

          <ul class="rail-list">
            <For each={projectsStore.projects}>
              {(project) => {
                const count = createMemo(() => needsYouCount(project.dir));
                // On screen beside others, so its button takes it off; the last one on screen stays.
                const beside = () => isShown(project.dir) && several();
                return (
                  <li
                    class="rail-item"
                    data-testid="rail-project"
                    data-project={project.dir}
                    data-shown={String(isShown(project.dir))}
                    data-focused={String(isFocused(project.dir))}
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
