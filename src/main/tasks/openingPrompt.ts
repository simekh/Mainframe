import type { TaskCardRef } from '../../shared/types';

const BRIEF =
  "This task is your brief: read it, plan, then start. Follow this repo's CLAUDE.md, and ask me when you need me.";

const NO_QUESTIONS =
  "No questions on this task: don't ask me clarifying questions; make reasonable choices and note them. " +
  "When the work is done and reviewed as this repo's CLAUDE.md requires, finish the branch without asking me, even where your workflow would ask how: " +
  'merge it, unless this CLAUDE.md integrates work another way, such as a pull request.';

type PromptCard = Pick<TaskCardRef, 'sourceKind' | 'number' | 'url' | 'labels'>;

/** What the prompt says of a task that is a card on the owner's to-do list, and the instruction to read it first. */
function cardParts({ sourceKind, labels, url }: PromptCard): string[] {
  return [
    `This task is a card on the owner's to-do list in ${sourceKind}${labels.length ? `, labelled ${labels.join(', ')}` : ''}${url ? `: ${url}` : '.'}`,
    `Before you plan, read the live card with your ${sourceKind} connector: it is your brief, and it may have changed since Mainframe last synced it. ` +
      "If you can't read it, ask me. Then mark the card as in progress the way this repo's CLAUDE.md says, or else by moving it to its board's " +
      'in-progress list or status, if it has one.',
  ];
}

export function openingPrompt(t: {
  title: string;
  description: string;
  branch: string;
  noQuestions: boolean;
  card?: PromptCard;
}): string {
  const worktreeNote =
    `Mainframe started you in this task's own worktree, on branch ${t.branch}, so don't call EnterWorktree. ` +
    'From inside a worktree, Claude Code refuses git commands aimed at the main checkout: when you need the main ' +
    'checkout, for example to merge, call ExitWorktree with action "keep" first.';
  const description = t.description.trim();
  const parts = [BRIEF, `Task: ${t.card?.number ? `${t.card.number} ` : ''}${t.title.trim()}`];
  if (t.card) parts.push(...cardParts(t.card));
  if (description) parts.push(t.card ? `From the owner: ${description}` : description);
  parts.push(worktreeNote);
  if (t.noQuestions) parts.push(NO_QUESTIONS);
  return parts.join('\n\n');
}
