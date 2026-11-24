import test from 'node:test';
import assert from 'node:assert/strict';
import {indiaYear, nextScheduledTime} from './schedule.mjs';

test('daily times use India time and roll over after the scheduled minute', () => {
  assert.equal(nextScheduledTime('08:00', Date.parse('2026-11-24T02:29:00Z')), Date.parse('2026-11-24T02:30:00Z'));
  assert.equal(nextScheduledTime('08:00', Date.parse('2026-11-24T02:30:00Z')), Date.parse('2026-11-25T02:30:00Z'));
  assert.throws(() => nextScheduledTime('24:00'), /Invalid/);
});

test('scheduled export year follows India date at the year boundary', () => {
  assert.equal(indiaYear(Date.parse('2026-12-31T18:29:00Z')), 2026);
  assert.equal(indiaYear(Date.parse('2026-12-31T18:30:00Z')), 2027);
});
