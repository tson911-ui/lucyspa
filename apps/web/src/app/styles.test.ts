import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// Step 2 acceptance (docs/UXUI_REDESIGN_DESIGN.md section 8): no gold anywhere, and app styles use
// tokens instead of color literals so both themes work.
const here = new URL('.', import.meta.url);
const webSrc = new URL('../', here).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const uiSrc = new URL('../../../../packages/ui/src/', here).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (name === 'node_modules' || name === '.next') return [];
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(css|tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test('the layout self-hosts a display font with the Vietnamese subset in normal and italic', () => {
  const layout = readFileSync(new URL('[locale]/layout.tsx', here), 'utf8');
  const block = /Playfair_Display\(\{([^}]*)\}\)/.exec(layout)?.[1] ?? '';
  assert.match(block, /subsets:\s*\['latin',\s*'vietnamese'\]/);
  assert.match(block, /style:\s*\['normal',\s*'italic'\]/);
  assert.match(block, /variable:\s*'--font-playfair-display'/);
  assert.match(layout, /playfairDisplay\.variable/);
});

test('no gold or ivory token or value remains in apps/web/src or packages/ui/src', () => {
  const pattern = /gold|ivory|#b69456|#e9d6aa|#faf7f1/i;
  for (const file of [
    ...sourceFiles(decodeURIComponent(webSrc)),
    ...sourceFiles(decodeURIComponent(uiSrc)),
  ]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), pattern, file);
  }
});

test('application stylesheets contain no hex color literals', () => {
  for (const name of ['customer.css', 'globals.css']) {
    const css = readFileSync(new URL(name, here), 'utf8');
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, name);
  }
});

test('legacy lucy color aliases are no longer used by application stylesheets', () => {
  for (const name of ['customer.css', 'globals.css']) {
    const css = readFileSync(new URL(name, here), 'utf8');
    assert.doesNotMatch(css, /var\(--lucy-(red|ink|muted|border)\)/, name);
  }
});
