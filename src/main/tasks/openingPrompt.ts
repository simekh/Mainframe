const BRIEF =
  "This task is your brief: read it, plan, then start. Follow this repo's CLAUDE.md, and ask me when you need me.";

const NO_QUESTIONS =
  "No questions on this task: don't ask me clarifying questions; make reasonable choices and note them. " +
  "When the work is done and reviewed as this repo's CLAUDE.md requires, finish the branch without asking me, even where your workflow would ask how: " +
  'merge it, unless this CLAUDE.md integrates work another way, such as a pull request.';

export function openingPrompt(t: {
  title: string;
  description: string;
  branch: string;
  noQuestions: boolean;
}): string {
  const worktreeNote =
    `Mainframe started you in this task's own worktree, on branch ${t.branch}, so don't call EnterWorktree. ` +
    'From inside a worktree, Claude Code refuses git commands aimed at the main checkout: when you need the main ' +
    'checkout, for example to merge, call ExitWorktree with action "keep" first.';
  const description = t.description.trim();
  const parts = [BRIEF, `Task: ${t.title.trim()}`];
  if (description) parts.push(description);
  parts.push(worktreeNote);
  if (t.noQuestions) parts.push(NO_QUESTIONS);
  return parts.join('\n\n');
}
