export function hiddenPrompt(label) {
  if (!process.stdin.isTTY) throw new Error('Run in an interactive terminal');
  process.stdout.write(`${label} (hidden): `);
  return new Promise(resolve => {
    let value = '';
    process.stdin.setRawMode(true); process.stdin.setEncoding('utf8'); process.stdin.resume();
    function input(data) {
      for (const character of data) {
        if (character === '\u0003') process.exit(130);
        if (character === '\r' || character === '\n') {
          process.stdin.removeListener('data', input); process.stdin.setRawMode(false); process.stdin.pause();
          process.stdout.write('\n'); resolve(value); return;
        }
        if (character === '\u007f') value = value.slice(0, -1);
        else if (value.length < 256) value += character;
      }
    }
    process.stdin.on('data', input);
  });
}
