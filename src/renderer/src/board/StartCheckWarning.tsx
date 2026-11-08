import { commitsThatArent } from '../../../shared/commitsThatArent';
import type { StartCheck } from '../../../shared/types';

/** What New task and the ticket say when the main checkout has commits that a new worktree won't have. */
export default function StartCheckWarning(props: { check: StartCheck; testId: string }) {
  return (
    <div class="nt-warn" data-testid={props.testId}>
      <strong>
        <code>{props.check.branch}</code> has {commitsThatArent(props.check.ahead)} on <code>{props.check.base}</code>.
      </strong>{' '}
      New worktrees start from <code>{props.check.base}</code>, so this task won't have{' '}
      {props.check.ahead === 1 ? 'it' : 'them'}. Push <code>{props.check.branch}</code> first, or start anyway.
    </div>
  );
}
