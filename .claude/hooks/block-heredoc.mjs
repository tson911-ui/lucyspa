// PreToolUse hook for Bash: blocks commands that contain a heredoc (<<). CLAUDE.md: on Windows write multi-line
// content with the Write/Edit tools instead. Exit code 2 blocks the call and sends stderr back to the model.
import { readFileSync } from 'node:fs';

let command = '';
try {
  command = JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.command ?? '';
} catch {
  process.exit(0);
}

if (typeof command === 'string' && command.includes('<<')) {
  process.stderr.write('Dùng Write/Edit thay heredoc (CLAUDE.md)\n');
  process.exit(2);
}
