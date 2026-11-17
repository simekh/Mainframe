import { createEffect, createSignal, Match, Show, Switch, type JSX } from 'solid-js';
import type { ByHandWhy, UpdateAvailable } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import Markdown from '../todo/MarkdownView';
import { closeUpdateDialog, updateFace, updateView } from './updateStore';

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

const versionOf = (current: string | null | undefined) => current ?? 'unreleased';

/** A release the app doesn't run yet: what it brings, then the Update button or the commands to run by hand. */
function Release(props: { available: UpdateAvailable; current: string | null; installing: boolean; onInstall: () => void; onLater: () => void }) {
  const how = () => props.available.how;
  const byHand = () => {
    const h = how();
    return h.kind === 'by-hand' ? h : undefined;
  };
  return (
    <>
      <p class="nt-sub">You have {versionOf(props.current)}.</p>
      <div class="update-notes" data-testid="update-notes">
        <Markdown text={props.available.notes} />
      </div>
      <Switch>
        <Match when={byHand()}>
          {(h) => (
            <div class="update-by-hand">
              <p>{WHY[h().why]()}</p>
              <pre data-testid="update-commands">{h().commands.join('\n')}</pre>
            </div>
          )}
        </Match>
        <Match when={how().kind === 'one-click'}>
          <p class="nt-hint">Updating restarts Mainframe. Your sessions stop and come back, as after Quit.</p>
        </Match>
      </Switch>
      <div class="nt-actions">
        <button class="btn" type="button" disabled={props.installing} onClick={() => props.onLater()}>
          Later
        </button>
        <Show when={how().kind === 'one-click'}>
          <button class="btn primary" type="button" disabled={props.installing} onClick={() => props.onInstall()}>
            {props.installing ? 'Restarting…' : 'Update'}
          </button>
        </Show>
      </div>
    </>
  );
}

/**
 * Mainframe's own updates, for the whole app: mounted once, shown while `updateFace()` names what to show. A face that
 * shows a release follows the update state as it changes, so a check that finds how to finish fills it in.
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
  const current = () => updateView()?.current ?? null;
  const closeButton = () => (
    <div class="nt-actions">
      <button class="btn" type="button" onClick={close}>
        Close
      </button>
    </div>
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
          <Match when={updateFace()?.kind === 'up-to-date'}>
            <h2 id="update-heading">Mainframe is up to date ({versionOf(current())})</h2>
            {closeButton()}
          </Match>
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
          {/* A known release, or an update that didn't finish: with the release once a check has found it. */}
          <Match when={updateFace()}>
            <h2 id="update-heading">
              {/* Without a release here, a check since has found none newer. */}
              {available()
                ? `Mainframe ${available()!.latest} is available`
                : updateFace()?.kind === 'unfinished'
                  ? "The update didn't finish"
                  : `Mainframe is up to date (${versionOf(current())})`}
            </h2>
            <Show when={updateFace()?.kind === 'unfinished' ? updateView()?.failure : undefined}>
              {(failure) => (
                <p class="nt-error" role="alert">
                  The update didn't finish: {failure()}
                </p>
              )}
            </Show>
            <Show when={error()}>
              {(message) => (
                <p class="nt-error" role="alert">
                  {message()}
                </p>
              )}
            </Show>
            <Show when={available()} fallback={closeButton()}>
              {(release) => <Release available={release()} current={current()} installing={installing()} onInstall={install} onLater={close} />}
            </Show>
          </Match>
        </Switch>
      </div>
    </dialog>
  );
}
