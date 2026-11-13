// Reads the terminal raw, as Claude Code does, and shows what arrives with an ESC as ^[, reads run
// together so a key split over two shows whole. Not `cat -v`: on Windows, Git Bash's `cat -v` gets no
// kitty keys through ConPTY.
process.stdin.setRawMode(true);
process.stdout.write('raw-reader-ready\r\n');
process.stdin.on('data', (d) => process.stdout.write(d.toString('latin1').replace(/\x1b/g, '^[')));
