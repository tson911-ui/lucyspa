import assert from 'node:assert/strict';
import { test } from 'node:test';
import { organizationDictionary } from '../../../i18n/organization';
import { opensInput } from '../../../lib/workforce/opens-input';
import { employee, owner, render } from '../../../test/support';
import { OrganizationScreen } from './organization';

const text = organizationDictionary('vi');
/** A header button that opens a dialog (the same words also appear in tab labels); it ends with "…" (C39). */
const hasButton = (markup: string, label: string) =>
  markup.includes(`ls-btn-label">${opensInput(label)}</span>`);

test('without any organization permission the screen only says so', () => {
  const markup = render(<OrganizationScreen />, employee([['VIEW_TEAMS', 'A']]));
  assert.ok(markup.includes(text.noAccess));
  assert.ok(!markup.includes('role="tablist"'));
});

test('viewers see the four tabs and no create action', () => {
  const markup = render(<OrganizationScreen />, employee([['VIEW_ORGANIZATION']]));
  for (const tab of [text.regions, text.areas, text.branches, text.appointments]) {
    assert.ok(markup.includes(tab), tab);
  }
  assert.ok(!hasButton(markup, text.createRegion));
  assert.ok(!hasButton(markup, text.appoint));
  // One page title, the owner and attendance notes as the page description, no legacy disclosure.
  assert.equal(markup.match(/<h1/g)?.length, 1);
  assert.ok(markup.includes(text.ownerNote));
  // Tab labels carry no count (Owner rule); the count lives in each table's "Hiển thị" line.
  assert.ok(!markup.includes(`${text.regions} (`));
  assert.ok(!markup.includes('<details'));
  assert.ok(!markup.includes('wf-table'));
});

test('the header action follows the tab and the permission', () => {
  const regions = render(<OrganizationScreen />, owner);
  assert.ok(hasButton(regions, text.createRegion));
  assert.ok(!hasButton(regions, text.appoint));

  const manager = employee([['VIEW_ORGANIZATION'], ['MANAGE_ORG_ASSIGNMENTS']]);
  const markup = render(<OrganizationScreen />, manager);
  // Appointments are managed with a different permission than the hierarchy.
  assert.ok(!hasButton(markup, text.createRegion));
});
