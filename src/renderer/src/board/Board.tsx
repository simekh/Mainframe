import { createComputed, createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import type { DiscardPreview, TaskView } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import { useProject } from '../projects/projectContext';
import { discardTask, focusTerminalOf, sessionOf, tasksOf, tasksStore } from '../tasksStore';
import DiscardDialog from './DiscardDialog';
import { now } from './ageClock';
import { playCardMoves, snapshotCards, type CardSpot } from './cardMoves';
import { laneOrder, type Lane } from './lanes';
import TaskCard from './TaskCard';
import { todoOf } from '../todo/todoStore';

// A flex row of lanes. Done is drawn only while it holds a card, last, so the others keep their places; in a narrow pane
// they make room for it.
const LANES: Array<{ lane: Lane; name: string; empty?: string }> = [
  { lane: 'needs-you', name: 'Needs you', empty: 'Nothing needs you' },
  { lane: 'working', name: 'Working', empty: 'Nothing running' },
  { lane: 'paused', name: 'Paused', empty: 'No paused tasks' },
  { lane: 'done', name: 'Done' },
];

/** The lanes of task cards. Cards that change place move there rather than jump. */
export default function Board() {
  const project = useProject();
  let root!: HTMLDivElement;
  const order = createMemo(() => laneOrder(tasksOf(project.dir).tasks, tasksStore.sessions, todoOf(project.dir)?.cards));
  const shownLanes = createMemo(() => LANES.filter(({ lane }) => lane !== 'done' || order().done.length > 0));
  // The paused task whose Discard waits for the owner's confirm, with what it would lose once that is read. Kept here, not
  // on its card, which goes once the task does.
  const [discarding, setDiscarding] = createSignal<{
    task: TaskView;
    preview: DiscardPreview | null;
    error: string | null;
  } | null>(null);
  const askDiscard = (task: TaskView) => {
    setDiscarding({ task, preview: null, error: null });
    window.mainframe.discardPreview(project.dir, task.id).then(
      (preview) => setDiscarding((d) => (d?.task.id === task.id ? { ...d, preview } : d)),
      (err: unknown) => setDiscarding((d) => (d?.task.id === task.id ? { ...d, error: errorMessage(err) } : d)),
    );
  };
  const closeDiscard = () => {
    setDiscarding(null);
    // The dialog hands the focus back to where it was; the selected task's terminal is where typing goes.
    const id = tasksOf(project.dir).selectedId;
    if (id) focusTerminalOf(project.dir, id);
  };
  // Each lane's ids, joined: it changes only when a card enters, leaves or changes place, so the
  // frequent msg updates measure nothing.
  const orderKey = createMemo(() => LANES.map(({ lane }) => order()[lane].map((t) => t.id).join(',')).join('|'));

  // Solid runs computations before it updates the DOM and effects after: the cards are measured
  // where they were in one and moved from there in the other. Off screen nothing moves: a flying
  // card is drawn over the whole window, over the projects on screen.
  let before = new Map<string, CardSpot>();
  createComputed(
    on(
      orderKey,
      () => {
        if (project.shown()) before = snapshotCards(root);
      },
      { defer: true },
    ),
  );
  createEffect(
    on(
      orderKey,
      () => {
        if (project.shown()) playCardMoves(root, before, window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      },
      { defer: true },
    ),
  );

  return (
    <div class="lanes" ref={root}>
      <For each={shownLanes()}>
        {({ lane, name, empty }) => (
          <section class="lane" data-testid="lane" data-lane={lane} data-empty={String(order()[lane].length === 0)}>
            <h3 class="lane-title">
              {name} <span class="lane-count">{order()[lane].length}</span>
            </h3>
            <ul class="cards" aria-label={name}>
              <For each={order()[lane]} fallback={<li class="lane-empty">{empty}</li>}>
                {(task) => (
                  <TaskCard
                    task={task}
                    session={sessionOf(task)}
                    lane={lane}
                    now={now()}
                    onDiscard={askDiscard}
                  />
                )}
              </For>
            </ul>
          </section>
        )}
      </For>
      <Show when={discarding()}>
        {(d) => (
          <DiscardDialog
            title={d().task.title}
            branch={d().task.branch}
            preview={d().preview}
            previewError={d().error}
            onDiscard={() => discardTask(project.dir, d().task.id)}
            onClose={closeDiscard}
          />
        )}
      </Show>
    </div>
  );
}
