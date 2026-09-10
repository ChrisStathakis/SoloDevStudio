import test from 'node:test';
import assert from 'node:assert/strict';
import { getDaysRemaining, toIsoDate } from './dates.ts';

test('returns 0 for missing or invalid dates', () => {
  assert.equal(getDaysRemaining(undefined), 0);
  assert.equal(getDaysRemaining('not-a-date'), 0);
});

test('computes days remaining relative to today', () => {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const plus5 = new Date(today);
  plus5.setDate(today.getDate() + 5);
  const minus3 = new Date(today);
  minus3.setDate(today.getDate() - 3);
  assert.equal(getDaysRemaining(fmt(today)), 0);
  assert.equal(getDaysRemaining(fmt(plus5)), 5);
  assert.equal(getDaysRemaining(fmt(minus3)), -3);
});

test('formats an ISO date string', () => {
  assert.match(toIsoDate(new Date('2026-09-03T12:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(toIsoDate(new Date('2026-09-03T12:00:00Z')), '2026-09-03');
});
