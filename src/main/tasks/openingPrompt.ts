import type { AgentName, TaskCardRef } from '../../shared/types';
import { ADAPTERS } from '../agents/adapters';
import type { Instructions } from '../agents/agent';

const brief = (i: Instructions) =>
  `This task is your brief: read it, plan, then start. Follow ${i.first}, and ask me when you need me.`;

const noQuestions = (i: Instructions) =>
  "No questions on this task: don't ask me clarifying questions; make reasonable choices and note them. " +
  `When the work is done and reviewed as ${i.requires}, finish the branch without asking me, even where your workflow would ask how: ` +
  `merge it, unless ${i.integrates} work another way, such as a pull request.`;

type PromptCard = Pick<TaskCardRef, 'sourceKind' | 'number' | 'url' | 'labels'>;

/** What the prompt says of a task that is a card on the owner's to-do list. */
const cardLine = ({ sourceKind, labels, url }: PromptCard) =>
  `This task is a card on the owner's to-do list in ${sourceKind}${labels.length ? `, labelled ${labels.join(', ')}` : ''}${url ? `: ${url}` : '.'}`;

/** The card's line, and the instruction to read the live card first. */
function cardParts(card: PromptCard, i: Instructions): string[] {
  const { sourceKind } = card;
  return [
    cardLine(card),
    `Before you plan, read the live card with your ${sourceKind} connector: it is your brief, and it may have changed since Mainframe last synced it. ` +
      `If you can't read it, ask me. Then mark the card as in progress the way ${i.again} says, or else by moving it to its board's ` +
      'in-progress list or status, if it has one.',
  ];
}

/** What the prompt says of a card Mainframe read from its list itself: the text that follows is the brief. */
function readCardParts(card: PromptCard, i: Instructions): string[] {
  const { sourceKind } = card;
  return [
    cardLine(card),
    `Here is the card as Mainframe read it from ${sourceKind} when the task started; it is your brief. ` +
      `If you have a ${sourceKind} connector, you may read the live card for later changes. ` +
      `Then mark the card as in progress the way ${i.again} says, if it says how.`,
  ];
}

/** A card's text as Mainframe read it, or the line for none, then the owner's note: in the prompt, or in its file. */
export function cardBrief(cardText: string, description: string): string {
  const parts = [cardText.trim() || 'The card has no description.'];
  if (description.trim()) parts.push(`From the owner: ${description.trim()}`);
  return parts.join('\n\n');
}

/** Where the description is, when it is too long for the command line and Mainframe has put it in a file. */
function descriptionInFile(file: string, what: string, are = false): string {
  return `${what} ${are ? 'are' : 'is'} in ${file}: ${are ? 'they are' : 'it is'} too long to pass on the command line. Read that file before you plan.`;
}

/** What the prompt says of the description, or of the file that holds it. */
function descriptionParts(t: { description: string; card?: PromptCard; cardText?: string; descriptionFile?: string }): string[] {
  const description = t.description.trim();
  if (t.cardText !== undefined) {
    if (!t.descriptionFile) return [cardBrief(t.cardText, description)];
    if (!description) return [descriptionInFile(t.descriptionFile, "The card's text")];
    return [descriptionInFile(t.descriptionFile, "The card's text and the owner's note on this task", true)];
  }
  if (!description) return [];
  if (t.descriptionFile) return [descriptionInFile(t.descriptionFile, t.card ? "The owner's note on this task" : "This task's description")];
  return [t.card ? `From the owner: ${description}` : description];
}

export function openingPrompt(t: {
  agent: AgentName;
  /** The main checkout. */
  projectDir: string;
  worktreePath: string;
  title: string;
  description: string;
  branch: string;
  noQuestions: boolean;
  card?: PromptCard;
  /** The card's text, when Mainframe read the card from its list itself: the session may have no connector to read it. */
  cardText?: string;
  /** Where the description (with `cardText`, the card's text too) is, instead of in this prompt. */
  descriptionFile?: string;
  /** Continue starts the task again, as its earlier conversation is gone. */
  continuing?: boolean;
}): string {
  const { instructions, worktreeNote } = ADAPTERS[t.agent];
  const parts = [brief(instructions), `Task: ${t.card?.number ? `${t.card.number} ` : ''}${t.title.trim()}`];
  if (t.continuing) {
    parts.push('This continues an earlier task of the same name. Its conversation is gone; any of its work that was merged is in the default branch.');
  }
  if (t.card) parts.push(...(t.cardText !== undefined ? readCardParts(t.card, instructions) : cardParts(t.card, instructions)));
  parts.push(...descriptionParts(t));
  parts.push(worktreeNote({ branch: t.branch, projectDir: t.projectDir, worktreePath: t.worktreePath }));
  if (t.noQuestions) parts.push(noQuestions(instructions));
  return parts.join('\n\n');
}
