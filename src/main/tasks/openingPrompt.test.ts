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

it("a card's prompt names it, asks the session to read the live card first and mark it in progress, and puts the owner's words after it", () => {
  const card = { sourceKind: 'Tracker', number: '#128', url: 'https://tracker.example/c/128', labels: ['UI', 'Backend'] };
  expect(openingPrompt({ ...t, description: 'web only', card })).toBe(
    brief +
      'Task: #128 Fix login\n\n' +
      "This task is a card on the owner's to-do list in Tracker, labelled UI, Backend: https://tracker.example/c/128\n\n" +
      'Before you plan, read the live card with your Tracker connector: it is your brief, and it may have changed since Mainframe last synced it. ' +
      "If you can't read it, ask me. Then mark the card as in progress the way this repo's CLAUDE.md says, or else by moving it to its board's " +
      'in-progress list or status, if it has one.\n\n' +
      'From the owner: web only\n\n' +
      tail,
  );
});

it('a card without a number, a URL or labels reads cleanly', () => {
  const card = { sourceKind: 'Tracker', number: null, url: null, labels: [] };
  const prompt = openingPrompt({ ...t, description: '', card });
  expect(prompt).toContain('\n\nTask: Fix login\n\n');
  expect(prompt).toContain("\n\nThis task is a card on the owner's to-do list in Tracker.\n\n");
  expect(prompt).not.toContain('From the owner');
  expect(prompt.endsWith('\n\n' + tail)).toBe(true);
});

const FILE = 'D:\\data\\tasks\\t1\\brief\\description.md';

it("with a description file, the prompt points at it in the description's place and holds none of the description", () => {
  const prompt = openingPrompt({ ...t, description: 'The button does nothing.', descriptionFile: FILE });
  expect(prompt).toBe(
    brief +
      'Task: Fix login\n\n' +
      `This task's description is in ${FILE}: it is too long to pass on the command line. Read that file before you plan.\n\n` +
      tail,
  );
  expect(prompt).not.toContain('The button does nothing.');
});

it("with a description file and a card, the file is called the owner's note", () => {
  const card = { sourceKind: 'Tracker', number: null, url: null, labels: [] };
  const prompt = openingPrompt({ ...t, description: 'web only', descriptionFile: FILE, card });
  expect(prompt).toContain(
    `\n\nThe owner's note on this task is in ${FILE}: it is too long to pass on the command line. Read that file before you plan.\n\n`,
  );
  expect(prompt).not.toContain('web only');
  expect(prompt).not.toContain('From the owner');
});

it('with no description, a description file is not mentioned', () => {
  expect(openingPrompt({ ...t, description: ' ', descriptionFile: FILE })).toBe(brief + 'Task: Fix login\n\n' + tail);
});

it('passes on no-questions mode', () => {
  expect(openingPrompt({ ...t, description: '', noQuestions: true })).toBe(
    brief + 'Task: Fix login\n\n' + tail + '\n\n' +
      "No questions on this task: don't ask me clarifying questions; make reasonable choices and note them. " +
      "When the work is done and reviewed as this repo's CLAUDE.md requires, finish the branch without asking me, even where your workflow would ask how: " +
      'merge it, unless this CLAUDE.md integrates work another way, such as a pull request.',
  );
});
