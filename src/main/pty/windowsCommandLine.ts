// Windows' limit on a command line is 32,767 UTF-16 units; this stays well under it.
const LIMIT = 32_000;

/**
 * True when the arguments surely fit in a Windows command line. Quoting at worst doubles an argument (each character
 * gains a backslash) and adds its two quotes and a space, so 2·length + 3 bounds what each takes.
 */
export function fitsWindowsCommandLine(argv: string[]): boolean {
  return argv.reduce((total, arg) => total + 2 * arg.length + 3, 0) <= LIMIT;
}
