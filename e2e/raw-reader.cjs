// Reads the terminal raw, as a Node program such as Claude Code does, and shows what arrives with an ESC
// as ^[, as `cat -v` would. On Windows, Git Bash's `cat -v` reads ConPTY's key events, which have no
// kitty keys, while a raw Node reader gets the bytes.
process.stdin.setRawMode(true);
process.stdout.write('raw-reader-ready\r\n');
process.stdin.on('data', (d) => process.stdout.write(`${d.toString('latin1').replace(/\x1b/g, '^[')}\r\n`));
