// Prints shell code that exports DATABASE_URL for a THROW-AWAY database name (argv[2]), reusing the host and credentials of the
// DATABASE_URL in .env without ever printing them. Used by the rehearsal of a deploy on a restored copy of the real database
// (docs/PHASE6_WAVE1_DEPLOY_CHECKLIST.md) and by local scratch runs.
//
//   eval "$(node scripts/scratch-db-env.mjs lucy_spa_rehearsal_scratch)" && echo "DB=${DATABASE_URL##*/}" && pnpm db:deploy
//
// Safety: for any name that is not clearly throw-away (lucy_spa_..._scratch|test|review|try|uxaudit|rehearsal...) the printed code
// FAILS (`false`), so an `&&` chain stops instead of falling back to the real DATABASE_URL of .env. After the export the code checks
// the database name once more.
import { readFileSync } from 'node:fs';

const name = process.argv[2];
if (
  !name ||
  !/^lucy_spa_[a-z0-9_]*(scratch|test|review|try|uxaudit|rehearsal)[a-z0-9_]*$/.test(name)
) {
  console.log('echo "refusing: not a throw-away database name" >&2; false');
  process.exit(0);
}
const line = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('DATABASE_URL='));
if (!line) {
  console.log('echo "no DATABASE_URL in .env" >&2; false');
  process.exit(0);
}
const url = new URL(
  line
    .slice('DATABASE_URL='.length)
    .trim()
    .replace(/^["']|["']$/g, ''),
);
const real = url.pathname.slice(1);
if (real === name) {
  console.log('echo "refusing: that is the real database" >&2; false');
  process.exit(0);
}
url.pathname = `/${name}`;
const check = `case "$DATABASE_URL" in */${name}) true;; *) echo "database name mismatch" >&2; false;; esac`;
console.log(`export DATABASE_URL='${url.toString()}'; ${check}`);
