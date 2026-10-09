import assert from 'node:assert/strict';
import test from 'node:test';
import { foldVietnamese, matchesQuery } from './search-core';

test('foldVietnamese: accents, đ and case are ignored', () => {
  assert.equal(foldVietnamese('Gội  ĐẦU'), 'goi dau');
  assert.equal(foldVietnamese('  Chăm sóc da cơ bản (full) '), 'cham soc da co ban (full)');
  assert.equal(foldVietnamese('Đính đá / charm'), 'dinh da / charm');
});

test('matchesQuery: every word must be found, in any order; empty matches all', () => {
  assert.equal(matchesQuery('Massage chân 60 phút', 'massage 60'), true);
  assert.equal(matchesQuery('Massage chân 60 phút', 'phut chan'), true);
  assert.equal(matchesQuery('Massage chân 60 phút', 'goi'), false);
  assert.equal(matchesQuery('Gội đầu', 'GOI DAU'), true);
  assert.equal(matchesQuery('Gội đầu', '   '), true);
  assert.equal(matchesQuery('Gội đầu', ''), true);
});
