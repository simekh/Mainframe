// Adapted from Parallel Code (MIT): src/components/PromptInput.tsx (its sending() guard) at 97c3558. See THIRD_PARTY_NOTICES.md.
import { createSignal } from 'solid-js';
import type { TaskView } from '../../../shared/types';
import { sessionOf, terminalOf } from '../tasksStore';
import { getTerminal } from '../terminal/registry';
import { cleanMessageText, sendMessage } from '../terminal/sendMessage';

// The send button doesn't take focus on click, so typing stays in the field.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** A box under the terminal whose text reaches the session as a paste and an Enter. */
export default function MessageField(props: { task: TaskView | undefined }) {
  let field!: HTMLTextAreaElement;
  // A draft per task, so text written for one session is never sent to another.
  const [drafts, setDrafts] = createSignal<Record<string, string>>({});
  const text = () => (props.task ? (drafts()[props.task.id] ?? '') : '');
  const setText = (value: string) => {
    const id = props.task?.id;
    if (id) setDrafts((all) => ({ ...all, [id]: value }));
  };

  /** The running session's terminal; a closed task's holds only its last output. */
  const target = () => (props.task?.session ? terminalOf(props.task.id) : null);
  const off = () => target() === null;
  const blank = () => !cleanMessageText(text()).trim();
  // Tasks whose last message still waits for its Enter: a message sent before it would join that paste.
  const [sending, setSending] = createSignal<ReadonlySet<string>>(new Set());
  const isSending = () => !!props.task && sending().has(props.task.id);
  const placeholder = () => {
    if (off()) return 'Reopen the session to send it a message';
    return sessionOf(props.task!)?.status?.state === 'blocked'
      ? 'Claude is waiting for your answer in the terminal'
      : 'Message this session';
  };

  const send = () => {
    const id = props.task?.id;
    const sessionId = target();
    const term = sessionId ? getTerminal(sessionId) : undefined;
    if (!id || !term || blank() || isSending()) return;
    // First: a focus-out from the terminal then reaches the program before the message's focus report.
    field.focus();
    const sent = () =>
      setSending((all) => {
        const rest = new Set(all);
        rest.delete(id);
        return rest;
      });
    // Called right after the paste, so a paste that throws leaves the task free to send again.
    sendMessage(term, text(), (submit, ms) => {
      setSending((all) => new Set(all).add(id));
      setTimeout(() => {
        try {
          submit();
        } finally {
          sent();
        }
      }, ms);
    });
    setText('');
  };

  // Enter sends; Shift+Enter keeps the textarea's own new line.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    send();
  };

  return (
    <div class="prompt">
      <textarea
        ref={field}
        data-testid="message-field"
        rows={1}
        aria-label="Message to the session"
        placeholder={placeholder()}
        disabled={off()}
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <div class="prompt-foot">
        <span class="prompt-hint" hidden={off()}>
          Enter sends it to the session. Shift+Enter adds a line.
        </span>
        <button
          class="send"
          data-testid="message-send"
          aria-label="Send"
          title="Send"
          disabled={off() || blank() || isSending()}
          onMouseDown={keepFocus}
          onClick={send}
        >
          <svg
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M7 11.5v-9M3 6.5l4-4 4 4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
