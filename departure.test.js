import test from 'node:test';
import assert from 'node:assert/strict';
import { nextDeparture } from './departure.js';

test('chooses the first actually catchable Manhattan-bound A and subtracts ten minutes', () => {
  const now = 1_000_000;
  const trains = [
    { type: 'subway', route: 'A', direction: 'N', arrivalTime: now + 599 },
    { type: 'subway', route: 'C', direction: 'N', arrivalTime: now + 620 },
    { type: 'subway', route: 'A', direction: 'S', arrivalTime: now + 650 },
    { type: 'subway', route: 'A', direction: 'N', directionLabel: 'Manhattan', arrivalTime: now + 721 },
  ];
  assert.deepEqual(nextDeparture(trains, now), {
    route: 'A', station: 'Utica Av', direction: 'N', directionLabel: 'Manhattan',
    arrivalTime: now + 721, leaveAt: now + 121, leaveInMinutes: 3, walkMinutes: 10,
  });
});

test('returns null when no train is reachable', () => {
  assert.equal(nextDeparture([{ type: 'subway', route: 'A', direction: 'N', arrivalTime: 1599 }], 1000), null);
});
