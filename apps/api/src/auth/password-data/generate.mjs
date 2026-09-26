// Offline refresh helper: download the pinned public source identified in README,
// then run `node <this file> <source path>`. Never accepts account passwords.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const expectedSha256 = '1472aafa2561df5e3293aee252aee3ca660c12b399a283cf808bb01b39be388b';
const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Provide the pinned public wordlist file path.');
const source = await readFile(sourcePath);
if (createHash('sha256').update(source).digest('hex') !== expectedSha256) {
  throw new Error('Public wordlist checksum mismatch.');
}
const digests = new Set();
for (const line of new TextDecoder('utf-8', { fatal: true }).decode(source).split(/\r?\n/)) {
  const normalized = line.normalize('NFC');
  const count = [...normalized].length;
  // Lucy Spa policy (follow-up Step 6): 8–128 code points; shorter entries fail on length.
  if (count >= 8 && count <= 128) {
    digests.add(createHash('sha256').update(normalized, 'utf8').digest('hex'));
  }
}
const lines = [...digests].sort().map((digest) => `  '${digest}',`);
await writeFile(
  new URL('./common-passwords.ts', import.meta.url),
  `// Generated public blocklist fingerprints. See README.md for source/license.\nexport const COMMON_PASSWORD_DIGESTS: readonly string[] = [\n${lines.join('\n')}\n];\n`,
);
console.log(`Generated ${digests.size} public blocklist fingerprints.`);
