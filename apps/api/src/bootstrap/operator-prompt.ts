/**
 * Protected operator channel helpers (design section 8): passwords are read only from a
 * hidden TTY prompt or piped stdin, never a flag, environment variable, file or log.
 */

export class UsageError extends Error {}

function readHidden(label: string): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u0003' || character === '\u0004') {
          return finish(new UsageError('Cancelled.'));
        }
        if (character === '\u007f' || character === '\b') {
          value = [...value].slice(0, -1).join('');
        } else {
          value += character;
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function readStdinLines(count: number): Promise<string[]> {
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    data += chunk as string;
    if (data.length > 8_192) throw new UsageError('Password input is too long.');
  }
  return data.split(/\r?\n/).slice(0, count);
}

/**
 * A new password entered twice. Interactive: two hidden prompts. Non-interactive: the
 * first stdin line, and — when `confirmFromStdin` — the second line must repeat it.
 */
export async function readNewPassword(subject: string, confirmFromStdin: boolean): Promise<string> {
  if (process.stdin.isTTY) {
    const first = await readHidden(`${subject} password (input hidden): `);
    const second = await readHidden(`Repeat ${subject} password: `);
    if (first !== second) throw new UsageError('Passwords do not match.');
    return first;
  }
  const [first = '', second] = await readStdinLines(2);
  if (confirmFromStdin && first !== (second ?? '')) {
    throw new UsageError('Passwords do not match (stdin needs the password on two lines).');
  }
  return first;
}
