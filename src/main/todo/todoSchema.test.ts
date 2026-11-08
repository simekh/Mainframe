import { expect, it } from 'vitest';
import { SYNC_ANSWER_JSON } from './todoSchema';

it('the sync answer schema carries no bounds, lengths, patterns or formats, which a structured-output schema may reject', () => {
  const schema = JSON.parse(SYNC_ANSWER_JSON);
  expect(schema.type).toBe('object');
  expect(SYNC_ANSWER_JSON).not.toMatch(
    /"(minimum|maximum|exclusiveMinimum|exclusiveMaximum|minLength|maxLength|minItems|maxItems|pattern|format)":/,
  );
});
