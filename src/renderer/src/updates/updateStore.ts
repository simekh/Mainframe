import { createSignal } from 'solid-js';
import type { CheckResult, UpdateView } from '../../../shared/types';
import { errorMessage } from '../bridgeError';

/** Mainframe's own update state, for the whole window; undefined until main has answered, which it does once the projects start. */
const [view, setView] = createSignal<UpdateView | undefined>(undefined);
export const updateView = view;

/**
 * What the dialog shows, null while it is closed: a known release (`available`), a check's other answers, or why the
 * last update didn't finish (`unfinished`), which shows the release too once a check has found it.
 */
export type UpdateFace = CheckResult | { kind: 'unfinished' };
const [face, setFace] = createSignal<UpdateFace | null>(null);
export const updateFace = face;
export const closeUpdateDialog = () => setFace(null);

/** Opens the dialog on a check's result; with none, on the release the pill stands for. */
export const showUpdateDialog = (result: CheckResult = { kind: 'available' }) => void setFace(result);

window.mainframe.onUpdate(setView);

/** Runs a check, as Check for Updates… does, and shows what it found. */
export const checkNow = (): Promise<void> => window.mainframe.checkForUpdates().then(showUpdateDialog);

window.mainframe.onCheckForUpdates(() => void checkNow());

/**
 * Main answers only once the projects have started. An update that didn't finish opens the dialog at once, and a check
 * fills in how to finish it: the commands live in the release the check finds.
 */
export const loadUpdate = (): Promise<void> =>
  window.mainframe.getUpdate().then(
    (next) => {
      setView(next);
      if (next.failure !== null) {
        setFace({ kind: 'unfinished' });
        void window.mainframe.checkForUpdates();
      }
    },
    (err: unknown) => console.error(`[updates] could not get the update state: ${errorMessage(err)}`),
  );
