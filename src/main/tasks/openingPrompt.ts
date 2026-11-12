import type { AgentName, TaskCardRef } from '../../shared/types';

/** How the prompt names the repo's instructions: the first mention in full, later ones short. */
type Instructions = { first: string; again: string; requires: string; integrates: string };

const CLAUDE_INSTRUCTIONS: Instructions = {
  first: "this repo's CLAUDE.md",
  again: "this repo's CLAUDE.md",
  requires: "this repo's CLAUDE.md requires",
  integrates: 'this CLAUDE.md integrates',
};

const OPENCODE_INSTRUCTIONS: Instructions = {
  first: "this repo's instructions (its AGENTS.md, or its CLAUDE.md when it has no AGENTS.md)",
  again: 'those instructions',
  requires: 'those instructions require',
  integrates: 'those instructions integrate',
};

const brief = (i: Instructions) =>
  `This task is your brief: read it, plan, then start. Follow ${i.first}, and ask me when you need me.`;

const noQuestions = (i: Instructions) =>
  "No questions on this task: don't ask me clarifying questions; make reasonable choices and note them. " +
  `When the work is done and reviewed as ${i.requires}, finish the branch without asking me, even where your workflow would ask how: ` +
  `merge it, unless ${i.integrates} work another way, such as a pull request.`;

type PromptCard = Pick<TaskCardRef, 'sourceKind' | 'number' | 'url' | 'labels'>;

/** What the prompt says of a task that is a card on the owner's to-do list, and the instruction to read it first. */
function cardParts({ sourceKind, labels, url }: PromptCard, i: Instructions): string[] {
  return [
    `This task is a card on the owner's to-do list in ${sourceKind}${labels.length ? `, labelled ${labels.join(', ')}` : ''}${url ? `: ${url}` : '.'}`,
    `Before you plan, read the live card with your ${sourceKind} connector: it is your brief, and it may have changed since Mainframe last synced it. ` +
      `If you can't read it, ask me. Then mark the card as in progress the way ${i.again} says, or else by moving it to its board's ` +
      'in-progress list or status, if it has one.',
  ];
}

/** Where the description is, when it is too long for the command line and Mainframe has put it in a file. */
function descriptionInFile(file: string, isCard: boolean): string {
  const what = isCard ? "The owner's note on this task" : "This task's description";
  return `${what} is in ${file}: it is too long to pass on the command line. Read that file before you plan.`;
}

export function openingPrompt(t: {
  title: string;
  description: string;
  branch: string;
  noQuestions: boolean;
  card?: PromptCard;
  /** Where the description is, instead of in this prompt. */
  descriptionFile?: string;
  agent: AgentName;
  /** The main checkout. */
  projectDir: string;
  worktreePath: string;
}): string {
  const instructions = t.agent === 'opencode' ? OPENCODE_INSTRUCTIONS : CLAUDE_INSTRUCTIONS;
  const worktreeNote = t.agent === 'opencode'
    ? `Mainframe started you in this task's own worktree, ${t.worktreePath}, on branch ${t.branch}. The main checkout is ${t.projectDir}: when you need it, for example to merge, run git there with git -C ${t.projectDir}.`
    : `Mainframe started you in this task's own worktree, on branch ${t.branch}, so don't call EnterWorktree. ` +
    'From inside a worktree, Claude Code refuses git commands aimed at the main checkout: when you need the main ' +
    'checkout, for example to merge, call ExitWorktree with action "keep" first.';
  const description = t.description.trim();
  const parts = [brief(instructions), `Task: ${t.card?.number ? `${t.card.number} ` : ''}${t.title.trim()}`];
  if (t.card) parts.push(...cardParts(t.card, instructions));
  if (description) {
    if (t.descriptionFile) parts.push(descriptionInFile(t.descriptionFile, t.card !== undefined));
    else parts.push(t.card ? `From the owner: ${description}` : description);
  }
  parts.push(worktreeNote);
  if (t.noQuestions) parts.push(noQuestions(instructions));
  return parts.join('\n\n');
}
