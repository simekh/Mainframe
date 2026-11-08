// The only runtime import is zod, so that the schema can be checked against the real `claude` CLI by importing this
// file under plain Node, which cannot resolve a relative import without its extension. Types are erased, so they may
// come from anywhere.
import * as z from 'zod/v4';
import type { TaskCardRef, TodoCard, TodoListRef, TodoNote, TodoSource } from '../../shared/types';

// No `.min`, `.max` or `.regex` anywhere here: the JSON Schema of SYNC_ANSWER goes to `claude -p --json-schema`,
// which may reject the keywords they add. Each `satisfies` keeps a schema in step with its type.

export const TODO_SOURCE = z.object({
  kind: z.string(),
  board: z.string().nullable(),
  list: z.string(),
  url: z.string().nullable(),
}) satisfies z.ZodType<TodoSource>;

export const TODO_LIST_REF = z.object({
  name: z.string(),
  board: z.string().nullable(),
  url: z.string().nullable(),
}) satisfies z.ZodType<TodoListRef>;

export const TODO_CARD = z.object({
  id: z.string(),
  number: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  labels: z.array(z.string()),
  checklists: z.array(
    z.object({
      name: z.string(),
      items: z.array(z.object({ text: z.string(), done: z.boolean() })),
    }),
  ),
  url: z.string().nullable(),
  forOwner: z.boolean(),
  urgent: z.boolean(),
}) satisfies z.ZodType<TodoCard>;

export const TODO_NOTE = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
}) satisfies z.ZodType<TodoNote>;

export const TASK_CARD_REF = z.object({
  sourceKind: z.string(),
  id: z.string(),
  number: z.string().nullable(),
  url: z.string().nullable(),
  labels: z.array(z.string()),
  position: z.number(),
  urgent: z.boolean(),
}) satisfies z.ZodType<TaskCardRef>;

/** What a sync run answers with: which of the four it is decides which fields it fills. */
export const SYNC_ANSWER = z.object({
  kind: z.enum(['tools', 'lists', 'cards', 'none']),
  message: z.string().optional(), // none
  connector: z.string().optional(), // tools
  readTools: z.array(z.string()).optional(),
  lists: z.array(TODO_LIST_REF).optional(),
  source: TODO_SOURCE.optional(), // cards
  cards: z.array(TODO_CARD).optional(),
});
export type SyncAnswer = z.infer<typeof SYNC_ANSWER>;

// Without the "$schema" key, which names a draft the CLI cannot resolve: it refuses the schema ("no schema with key or
// ref https://json-schema.org/draft/2020-12/schema"). The rest, such as "additionalProperties": false, it takes.
const { $schema: _draft, ...syncAnswerSchema } = z.toJSONSchema(SYNC_ANSWER);
export const SYNC_ANSWER_JSON = JSON.stringify(syncAnswerSchema);
