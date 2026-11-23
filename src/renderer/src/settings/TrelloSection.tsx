import { createMemo, Show } from 'solid-js';
import { connectTrello, disconnectTrello, setTrelloClientId, trelloConnection } from './trelloStore';

/** The one Trello sign-in every Trello project reads with, and the user's own Trello app if they bring one. */
export default function TrelloSection() {
  let clientId!: HTMLInputElement;
  // Written to the field only when the saved id changes, so a view that comes in while typing keeps what was typed.
  const savedId = createMemo(() => trelloConnection()?.ownClientId ?? '');
  return (
    <Show when={trelloConnection()}>
      {(t) => (
        <section class="settings-section" aria-labelledby="settings-trello">
          <h3 id="settings-trello" class="settings-title">
            Trello
          </h3>
          <Show
            when={t().connected && !t().needsReconnect}
            fallback={
              <div class="settings-row">
                <span class="settings-key">Account</span>
                <Show when={t().needsReconnect}>
                  <span class="settings-why">Trello asked to sign in again.</span>
                </Show>
                <button
                  class="btn primary settings-find"
                  type="button"
                  data-testid="trello-connect"
                  disabled={t().connecting}
                  onClick={connectTrello}
                >
                  {t().connecting ? 'Waiting for your browser…' : t().needsReconnect ? 'Reconnect Trello' : 'Connect Trello'}
                </button>
              </div>
            }
          >
            <div class="settings-row">
              <span class="settings-key">Account</span>
              <span data-testid="trello-user">{t().username ? `Connected as @${t().username}` : 'Connected to Trello'}</span>
              <button class="btn settings-find" type="button" data-testid="trello-disconnect" onClick={disconnectTrello}>
                Disconnect
              </button>
            </div>
            <p class="settings-hint">To revoke Mainframe's access too, remove it under Connected apps in your Atlassian account.</p>
          </Show>
          <Show when={!t().remembers}>
            <p class="settings-hint">This system can't keep the sign-in safely, so you connect again after each restart.</p>
          </Show>
          <Show when={t().error}>
            {(message) => (
              <p class="settings-error" role="alert" data-testid="trello-error">
                {message()}
              </p>
            )}
          </Show>
          <details class="settings-advanced">
            <summary>Advanced: use my own Trello app</summary>
            <form
              class="settings-row"
              onSubmit={(e) => {
                e.preventDefault();
                setTrelloClientId(clientId.value.trim() || null);
              }}
            >
              <label class="settings-key" for="settings-trello-client-id">
                Client id
              </label>
              <input
                ref={clientId}
                id="settings-trello-client-id"
                class="settings-input"
                type="text"
                spellcheck={false}
                autocomplete="off"
                placeholder="Mainframe's own app"
                data-testid="trello-client-id"
                value={savedId()}
              />
              <button class="btn" type="submit" data-testid="trello-client-save">
                Save
              </button>
            </form>
            <p class="settings-hint">
              Create an app at <code>trello.com/power-ups/admin</code> and add an OAuth 2.0 public client with the callback URLs{' '}
              <code>http://127.0.0.1:33333/callback</code>,{' '}
              <code>http://127.0.0.1:33334/callback</code> and <code>http://127.0.0.1:33335/callback</code>, and the scopes Read
              boards, Write boards and Read members. Leave it empty to use Mainframe's own app. Changing it signs you out of
              Trello.
            </p>
          </details>
        </section>
      )}
    </Show>
  );
}
