import { it, expect } from 'vitest';
import { openingPrompt } from './openingPrompt';

const tail =
  "Mainframe started you in this task's own worktree, on branch worktree-fix-login, so don't call EnterWorktree. " +
  'From inside a worktree, Claude Code refuses git commands aimed at the main checkout: when you need the main ' +
  'checkout, for example to merge, call ExitWorktree with action "keep" first.';

const brief = "This task is your brief: read it, plan, then start. Follow this repo's CLAUDE.md, and ask me when you need me.\n\n";
const t = { title: 'Fix login', branch: 'worktree-fix-login', noQuestions: false };

it('gives the brief, the description and the worktree note', () => {
  expect(openingPrompt({ ...t, description: 'The button does nothing.\nOnly on iOS.' })).toBe(
    brief + 'Task: Fix login\n\nThe button does nothing.\nOnly on iOS.\n\n' + tail,
  );
});

it('leaves out an empty description', () => {
  expect(openingPrompt({ ...t, description: '  \n' })).toBe(brief + 'Task: Fix login\n\n' + tail);
});

it('passes on no-questions mode', () => {
  expect(openingPrompt({ ...t, description: '', noQuestions: true })).toBe(
    brief + 'Task: Fix login\n\n' + tail + '\n\n' +
      "No questions on this task: don't ask me clarifying questions; make reasonable choices and note them. " +
      "When the work is done and reviewed as this repo's CLAUDE.md requires, merge without asking me, skipping the merge menu.",
  );
});
