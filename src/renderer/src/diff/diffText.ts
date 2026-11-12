import type { ChangedFile, DiffResult, FileDiff } from '../../../shared/types';

/** Untracked files read as U, as in Parallel Code. */
export const statusLetter = (status: ChangedFile['status']): string => (status === '?' ? 'U' : status);

/** What a file shows in place of its lines; null when it has lines to show. */
export function noteText(file: FileDiff): string | null {
  switch (file.note) {
    case null:
      return null;
    case 'binary':
      return 'Binary file, not shown.';
    case 'tooLarge':
      return file.added !== null && file.removed !== null
        ? `Too large to show here (${file.added + file.removed} lines changed).`
        : 'Too large to show here.';
    case 'notShown':
      return "Not shown: this task's changes are too large to show at once. Click this file in the session panel to see it.";
    case 'modeOnly':
      return 'No line changes (file mode changed).';
    case 'noLines':
      return 'No line changes.';
    case 'empty':
      return 'Empty file.';
  }
}

/** What the window says in place of the files; null when there are files to show. */
export function resultMessage(result: DiffResult): string | null {
  switch (result.kind) {
    case 'files':
      return result.files.length === 0 ? 'No changes' : null;
    case 'noWorktree':
      return 'Worktree removed: there are no changes to show.';
    case 'failed':
      return `Mainframe couldn't read the changes: ${result.message}`;
  }
}
