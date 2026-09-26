import { lagosDayStart, thisWeek, tonight } from './time-window';

/**
 * These boundaries decide every number on the dashboard, so they are pinned
 * rather than trusted. Nigeria is UTC+01:00 all year with no daylight saving.
 */
describe('lagosDayStart', () => {
  it('is 23:00 UTC the previous day, because Lagos is UTC+1', () => {
    // 2026-09-26 09:15 UTC is 10:15 on the 26th in Lagos.
    const start = lagosDayStart(new Date('2026-09-26T09:15:00.000Z'));
    expect(start.toISOString()).toBe('2026-09-25T23:00:00.000Z');
  });

  // The case that catches an off-by-one-day bug: just after Lagos midnight, UTC
  // is still on the previous date.
  it('rolls over at Lagos midnight, not UTC midnight', () => {
    const justBefore = lagosDayStart(new Date('2026-09-26T22:59:59.000Z')); // 23:59 Lagos 26th
    const justAfter = lagosDayStart(new Date('2026-09-26T23:00:01.000Z')); // 00:00 Lagos 27th

    expect(justBefore.toISOString()).toBe('2026-09-25T23:00:00.000Z');
    expect(justAfter.toISOString()).toBe('2026-09-26T23:00:00.000Z');
  });

  it('treats 01:30 Lagos as the new day, not the night before', () => {
    // A club's takings at 01:30 feel like "last night" but belong to the
    // calendar day the venue's bank and accountant use.
    const start = lagosDayStart(new Date('2026-09-27T00:30:00.000Z')); // 01:30 Lagos 27th
    expect(start.toISOString()).toBe('2026-09-26T23:00:00.000Z');
  });

  it('handles a month boundary', () => {
    const start = lagosDayStart(new Date('2026-10-01T00:30:00.000Z')); // 01:30 Lagos Oct 1
    expect(start.toISOString()).toBe('2026-09-30T23:00:00.000Z');
  });
});

describe('tonight', () => {
  it('runs from Lagos midnight to now', () => {
    const now = new Date('2026-09-26T09:15:00.000Z');
    const w = tonight(now);
    expect(w.from.toISOString()).toBe('2026-09-25T23:00:00.000Z');
    expect(w.to).toBe(now);
  });
});

describe('thisWeek', () => {
  it('covers 7 Lagos days including today', () => {
    const now = new Date('2026-09-26T09:15:00.000Z');
    const w = thisWeek(now);

    // 6 days before the start of today's Lagos day.
    expect(w.from.toISOString()).toBe('2026-09-19T23:00:00.000Z');
    expect(w.to).toBe(now);
    expect(w.to.getTime() - w.from.getTime()).toBeGreaterThan(6 * 24 * 3600_000);
  });

  it('starts no later than tonight does', () => {
    const now = new Date('2026-09-26T09:15:00.000Z');
    expect(thisWeek(now).from.getTime()).toBeLessThan(tonight(now).from.getTime());
  });
});
