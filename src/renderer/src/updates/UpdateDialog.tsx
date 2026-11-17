import { createEffect, createSignal, Match, Show, Switch, type JSX } from 'solid-js';
import type { ByHandWhy, UpdateAvailable } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import Markdown from '../todo/MarkdownView';
import { closeUpdateDialog, updateFace, updateView, versionOf } from './updateStore';

/** Why one click can't make the update, above the commands that do. Made each time: a node can be in one place only. */
const WHY: Record<ByHandWhy, () => JSX.Element> = {
  'not-launcher': () => (
    <>
      Mainframe wasn't started with <code>npm start</code>, so it can't restart itself.
    </>
  ),
  uncommitted: () => 'This copy has changes of its own. Commit or set them aside, then:',
  'own-commits': () => "This copy's branch has commits of its own, so merge the release yourself:",
};

/** A release the app doesn't run yet: what it brings, then the Update button or the commands to run by hand. */
function Release(props: { available: UpdateAvailable; version: string; installing: boolean; onInstall: () => void; onLater: () => void }) {
  const byHand = () => {
    const how = props.available.how;
    return how.kind === 'by-hand' ? how : undefined;
  };
  const later = () => (
    <button class="btn" type="button" disabled={props.installing} onClick={() => props.onLater()}>
      Later
    </button>
  );
  return (
    <>
      <p class="nt-sub">You have {props.version}.</p>
      <div class="update-notes" data-testid="update-notes">
        <Markdown text={props.available.notes} />
      </div>
      <Show
        when={byHand()}
        fallback={
          <>
            <p class="nt-hint">Updating restarts Mainframe. Your sessions stop and come back, as after Quit.</p>
            <div class="nt-actions">
              {later()}
              <button class="btn primary" type="button" disabled={props.installing} onClick={() => props.onInstall()}>
                {props.installing ? 'Restarting…' : 'Update'}
              </button>
            </div>
          </>
        }
      >
        {(h) => (
          <>
            <div class="update-by-hand">
              <p>{WHY[h().why]()}</p>
              <pre data-testid="update-commands">{h().commands.join('\n')}</pre>
            </div>
            <div class="nt-actions">{later()}</div>
          </>
        )}
      </Show>
    </>
  );
}

/**
 * Mainframe's own updates, for the whole app: mounted once, shown while `updateFace()` names what to show. A face that
 * shows a release follows the update state as it changes, so a check that finds how to finish an update that didn't
 * fills it in.
 */
export default function UpdateDialog() {
  let dialog!: HTMLDialogElement;
  const [installing, setInstalling] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  createEffect(() => {
    if (updateFace() && !dialog.open) {
      setError(null);
      dialog.showModal();
    }
  });
  const close = () => dialog.close();
  // On success the app quits. A refusal comes with the update state's commands, which then show in place of the button.
  const install = () => {
    setInstalling(true);
    setError(null);
    window.mainframe.installUpdate().catch((err: unknown) => {
      setError(errorMessage(err));
      setInstalling(false);
    });
  };
  const failed = () => {
    const face = updateFace();
    return face?.kind === 'failed' ? face : undefined;
  };
  const available = () => updateView()?.available ?? null;
  const failure = () => updateView()?.failure ?? null;
  const closeButton = () => (
    <div class="nt-actions">
      <button class="btn" type="button" onClick={close}>
        Close
      </button>
    </div>
  );
  const failureLine = () => (
    <Show when={failure()}>
      {(why) => (
        <p class="nt-error" role="alert">
          The update didn't finish: {why()}
        </p>
      )}
    </Show>
  );

  return (
    <dialog
      ref={dialog}
      class="nt-dialog update-dialog"
      data-testid="update-dialog"
      aria-labelledby="update-heading"
      // A press here is not one on the board, which would fold the panels over it.
      onMouseDown={(e) => e.stopPropagation()}
      onCancel={(e) => installing() && e.preventDefault()}
      onClose={closeUpdateDialog}
    >
      <div class="nt">
        <Switch>
          <Match when={failed()}>
            {(f) => (
              <>
                <h2 id="update-heading">Check for updates</h2>
                <p class="nt-error" role="alert">
                  Couldn't check for updates: {f().why}
                </p>
                {closeButton()}
              </>
            )}
          </Match>
          {/* A check found none newer, or one since has found none for the pill's release. */}
          <Match when={updateFace()?.kind === 'up-to-date' || (updateFace() && !available() && !failure())}>
            <h2 id="update-heading">Mainframe is up to date ({versionOf(updateView())})</h2>
            {closeButton()}
          </Match>
          <Match when={updateFace() && available()}>
            {(release) => (
              <>
                <h2 id="update-heading">Mainframe {release().latest} is available</h2>
                {failureLine()}
                <Show when={error()}>
                  {(message) => (
                    <p class="nt-error" role="alert">
                      {message()}
                    </p>
                  )}
                </Show>
                <Release available={release()} version={versionOf(updateView())} installing={installing()} onInstall={install} onLater={close} />
              </>
            )}
          </Match>
          {/* An update that didn't finish, with no newer release found. */}
          <Match when={updateFace()}>
            <h2 id="update-heading">The update didn't finish</h2>
            {failureLine()}
            {closeButton()}
          </Match>
        </Switch>
      </div>
    </dialog>
  );
}
