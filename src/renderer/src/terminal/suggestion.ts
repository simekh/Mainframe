// A line that opens with the star and a label, then ` · `: "✦ You should know · …", "✦ Heads up · …".
// The label has varied between Claude Code versions, so it is any text.
const SUGGESTION_LINE = /^ *✦ .+ · /;
const CHOICES_WITHIN = 3;
// The end of the row of choices, which a narrow terminal may wrap onto the next line.
const DISMISS = /\b0:\s+Dismiss\b/;

/**
 * Whether the lines show a suggestion Claude Code is waiting on: its label line, with the row of
 * choices (ending `0: Dismiss`) within the next three lines. Both together, so Claude quoting the
 * words in its answer doesn't count.
 */
export function hasSuggestion(lines: readonly string[]): boolean {
  return lines.some(
    (line, i) =>
      SUGGESTION_LINE.test(line) && DISMISS.test(lines.slice(i + 1, i + 1 + CHOICES_WITHIN).join(' ')),
  );
}
