import { createComputed, createEffect, createMemo, For, on } from 'solid-js';
import { useProject } from '../projects/projectContext';
import { sessionOf, tasksOf, tasksStore } from '../tasksStore';
import { now } from './ageClock';
import { playCardMoves, snapshotCards, type CardSpot } from './cardMoves';
import { laneOrder, type Lane } from './lanes';
import TaskCard from './TaskCard';
import { todoOf } from '../todo/todoStore';

// A flex row: plan 2b's TODO lane joins at its start.
const LANES: Array<{ lane: Lane; name: string; empty: string }> = [
  { lane: 'needs-you', name: 'Needs you', empty: 'Nothing needs you' },
  { lane: 'working', name: 'Working', empty: 'Nothing running' },
  { lane: 'closed', name: 'Closed', empty: 'No closed tasks' },
];

/** The lanes of task cards. Cards that change place move there rather than jump. */
export default function Board() {
  const project = useProject();
  let root!: HTMLDivElement;
  const order = createMemo(() => laneOrder(tasksOf(project.dir).tasks, tasksStore.sessions, todoOf(project.dir)?.cards));
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
      <For each={LANES}>
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
                  />
                )}
              </For>
            </ul>
          </section>
        )}
      </For>
    </div>
  );
}
