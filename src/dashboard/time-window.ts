/**
 * Reporting windows.
 *
 * "Tonight" is the venue-local calendar day in Africa/Lagos, midnight to
 * midnight. Nigeria is a single timezone with no daylight saving (UTC+01:00
 * year round), so this is a fixed offset and needs no timezone database.
 *
 * Midnight is deliberately NOT the nightlife boundary - a club's takings at
 * 01:30 belong to that night colloquially, but a venue reconciling money reads
 * the same calendar day its bank and its accountant use. Picking 6am would make
 * "tonight" disagree with every other record. Stated here because it is the
 * kind of decision that silently changes every number on the dashboard.
 */
export const LAGOS_UTC_OFFSET_MINUTES = 60;

export interface TimeWindow {
  from: Date;
  to: Date;
}

/** Start of the Lagos calendar day containing `now`, as a UTC instant. */
export function lagosDayStart(now: Date = new Date()): Date {
  const lagos = new Date(now.getTime() + LAGOS_UTC_OFFSET_MINUTES * 60_000);
  const midnightLagos = Date.UTC(
    lagos.getUTCFullYear(),
    lagos.getUTCMonth(),
    lagos.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  return new Date(midnightLagos - LAGOS_UTC_OFFSET_MINUTES * 60_000);
}

/** Midnight-to-now in Lagos. */
export function tonight(now: Date = new Date()): TimeWindow {
  return { from: lagosDayStart(now), to: now };
}

/**
 * The last 7 Lagos calendar days including today, so "this week" is a rolling
 * window rather than depending on which day a week is taken to start.
 */
export function thisWeek(now: Date = new Date()): TimeWindow {
  const start = lagosDayStart(now);
  return { from: new Date(start.getTime() - 6 * 24 * 60 * 60_000), to: now };
}
