// Throw-away browser profile for the headless render/audit tools (docs/UXUI_REDESIGN_DESIGN.md 21.2, 21.5).
// Every run used to leave a profile folder in TEMP (hundreds of MB over a day of audits, enough to fill a disk).
//
//   const profile = createProfile('uxui-');   // also sweeps stale folders of our prefixes
//   ... spawn the browser with --user-data-dir=<profile> ...
//   finally { await disposeProfile(profile, child); }
//
// A folder is removed when the run ends (finally), when the process exits for any reason (exit handler,
// Ctrl+C included) and, as a safety net, when a later run finds one older than `STALE_MS`.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Prefixes owned by these tools; nothing else in TEMP is ever touched. */
export const PROFILE_PREFIXES = ['uxui-', 'uxaudit-', 'uxflow-', 'uxhover-', 'uxtoast-'];

/** Old enough that no running tool can still own it. */
const STALE_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function removeFolder(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    return true;
  } catch {
    return false; // the browser may still hold a file; the next run's sweep retries
  }
}

/** Removes abandoned profile folders of our prefixes older than `STALE_MS`. Returns how many went. */
export function sweepStaleProfiles(now = Date.now()) {
  let removed = 0;
  let names;
  try {
    names = readdirSync(tmpdir());
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!PROFILE_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const path = join(tmpdir(), name);
    try {
      const stat = statSync(path);
      if (stat.isDirectory() && now - stat.mtimeMs > STALE_MS && removeFolder(path)) removed += 1;
    } catch {
      // vanished or locked; ignore
    }
  }
  return removed;
}

/** A fresh empty profile folder (`prefix` must be one of `PROFILE_PREFIXES`). */
export function createProfile(prefix) {
  if (!PROFILE_PREFIXES.includes(prefix)) throw new Error(`Unknown profile prefix ${prefix}`);
  const swept = sweepStaleProfiles();
  if (swept > 0)
    console.log(`(removed ${swept} old browser profile folder${swept === 1 ? '' : 's'} from TEMP)`);
  const profile = mkdtempSync(join(tmpdir(), prefix));
  // Last resort for an uncaught error or `process.exit()` that skips the finally block.
  process.once('exit', () => removeFolder(profile));
  process.once('SIGINT', () => process.exit(130));
  return profile;
}

/** Stops the browser (and its child processes) and deletes the profile. Call it in `finally`. */
export async function disposeProfile(profile, child) {
  if (child && child.exitCode === null && child.pid) {
    if (process.platform === 'win32') {
      // Edge/Chrome spawn helper processes that keep the profile files open; kill the whole tree.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  }
  await sleep(300);
  removeFolder(profile);
}
