/** An error's message, without the "Error invoking remote method '<channel>': Error: " that invoke adds. */
export function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
}
