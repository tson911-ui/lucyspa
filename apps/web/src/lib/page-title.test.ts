import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { getCustomerDictionary } from '../i18n/customer';
import { getWorkforceDictionary } from '../i18n/workforce';
import { pageTitle } from './page-title';

const FORM = /^\S.* – Lucy Spa$/;

test('pageTitle: the page first, a spaced en dash, the brand last', () => {
  assert.equal(pageTitle('Dịch vụ'), 'Dịch vụ – Lucy Spa');
  assert.match(pageTitle('Giỏ hàng'), FORM);
  assert.doesNotMatch(pageTitle('Giỏ hàng'), /[·—]/, 'never a middle dot or an em dash');
});

test('the member and staff layout titles use the same form', () => {
  for (const title of [
    getCustomerDictionary('vi').meta.title,
    getCustomerDictionary('en').meta.title,
    getWorkforceDictionary('vi').meta.title,
    getWorkforceDictionary('en').meta.title,
  ]) {
    assert.match(title, FORM, title);
  }
});

// Every title source in the web app goes through `pageTitle`: no "· Lucy Spa", "— Lucy Spa" or "Lucy Spa —" outside the home brand line.
test('no other title form is left in the web app', () => {
  const root = join(import.meta.dirname, '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
    }
  };
  walk(root);
  const offenders = files.filter((file) => {
    const source = readFileSync(file, 'utf8')
      // The home page title is the brand line with its tagline (C41: kept).
      .replace(/title: '(Lucy Spa — [^']*)'/g, '')
      .replace(/`\$\{SITE_NAME\} — \$\{site\.tagline\}`/g, '');
    return /(?:·|—) (?:Lucy Spa|\$\{SITE_NAME\})|Lucy Spa —/.test(source);
  });
  assert.deepEqual(offenders, []);
});
