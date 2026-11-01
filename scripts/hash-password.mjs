import { hashPassword } from '../src/auth/password.mjs';
import { saveLocalOwner } from './local-owner-config.mjs';
if (!process.stdin.isTTY) throw new Error('Run in an interactive terminal');
process.stdout.write('Owner password (16+ characters, hidden): ');
process.stdin.setRawMode(true);
process.stdin.resume();
let password = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async data => {
  for (const character of data) {
    if (character === '\u0003') process.exit(130);
    if (character === '\r' || character === '\n') {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      try {
        const hash = await hashPassword(password);
        password = '';
        if (process.argv.includes('--save')) {
          await saveLocalOwner(hash);
          console.log('\nOwner password hash saved to .env.local; session secret rotated. Run npm run dev, then sign in with the password you entered.');
        } else console.log(`\nOWNER_PASSWORD_HASH=${hash}`);
      }
      catch (error) { console.error(`\n${error.message}`); process.exitCode = 1; }
      return;
    }
    if (character === '\u007f') password = password.slice(0, -1);
    else if (password.length <= 256) password += character;
  }
});
