import type { Broadcast, BroadcastSchedule } from '../types';

const SECOND = 1_000;

function timestampOf(value: Date | string | number): number {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(`invalid broadcast timestamp: ${String(value)}`);
  return timestamp;
}

/** Resolve the one broadcast active at a timestamp. This is the sole place
 * where a repeating schedule becomes an absolute television timeline. */
export function broadcastAt(
  schedule: BroadcastSchedule,
  timestamp: Date | string | number,
): Broadcast {
  const at = timestampOf(timestamp);
  const anchor = timestampOf(schedule.anchorAt);
  const cycleMs = schedule.cycleDurationSeconds * SECOND;
  const cycleIndex = Math.floor((at - anchor) / cycleMs);
  const cycleStartsAt = anchor + cycleIndex * cycleMs;
  const offsetSeconds = Math.floor((at - cycleStartsAt) / SECOND);

  let low = 0;
  let high = schedule.broadcasts.length - 1;
  let selected = schedule.broadcasts[0]!;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = schedule.broadcasts[middle]!;
    if (offsetSeconds < candidate.startsAtOffsetSeconds) high = middle - 1;
    else if (offsetSeconds >= candidate.endsAtOffsetSeconds) low = middle + 1;
    else {
      selected = candidate;
      break;
    }
  }

  const { startsAtOffsetSeconds, endsAtOffsetSeconds, ...broadcast } = selected;
  return {
    ...broadcast,
    scheduleId: schedule.id,
    channelId: schedule.channelId,
    startsAt: new Date(cycleStartsAt + startsAtOffsetSeconds * SECOND).toISOString(),
    endsAt: new Date(cycleStartsAt + endsAtOffsetSeconds * SECOND).toISOString(),
  };
}

export function nextBroadcast(schedule: BroadcastSchedule, current: Broadcast): Broadcast {
  return broadcastAt(schedule, current.endsAt);
}

/** Find a show's current or next slot within one complete schedule cycle. */
export function nextAiring(
  schedule: BroadcastSchedule,
  showSlug: string,
  timestamp: Date | string | number,
): Broadcast | null {
  let candidate = broadcastAt(schedule, timestamp);
  for (let index = 0; index <= schedule.broadcasts.length; index += 1) {
    if (candidate.show?.slug === showSlug) return candidate;
    candidate = nextBroadcast(schedule, candidate);
  }
  return null;
}

/** Active item followed by the requested number of later items. */
export function nowAndNext(
  schedule: BroadcastSchedule,
  timestamp: Date | string | number,
  count = 2,
): Broadcast[] {
  const result: Broadcast[] = [];
  let current = broadcastAt(schedule, timestamp);
  while (result.length < count) {
    result.push(current);
    current = nextBroadcast(schedule, current);
  }
  return result;
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedParts(timestamp: Date | string | number, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('nl-NL', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Partial<ZonedParts> = {};
  for (const part of formatter.formatToParts(new Date(timestampOf(timestamp)))) {
    if (part.type !== 'literal' && part.type in { year: 1, month: 1, day: 1, hour: 1, minute: 1, second: 1 }) {
      parts[part.type as keyof ZonedParts] = Number(part.value);
    }
  }
  return parts as ZonedParts;
}

/** Convert a channel-local civil time to an instant. The correction loop
 * handles ordinary timezone offsets and DST without pulling scheduling logic
 * into components. Day boundaries are never ambiguous in the supported IANA
 * zones. */
export function zonedDateTime(
  dateKey: string,
  timezone: string,
  hour = 0,
  minute = 0,
): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`invalid guide date: ${dateKey}`);
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute);
  let guess = desired;
  for (let pass = 0; pass < 3; pass += 1) {
    const actual = zonedParts(guess, timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    guess += desired - actualAsUtc;
  }
  return new Date(guess);
}

export function channelDateKey(timestamp: Date | string | number, timezone: string): string {
  const parts = zonedParts(timestamp, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function shiftDateKey(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`invalid guide date: ${dateKey}`);
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return value.toISOString().slice(0, 10);
}

export function broadcastsForChannelDay(
  schedule: BroadcastSchedule,
  dateKey: string,
  timezone: string,
): Broadcast[] {
  const from = zonedDateTime(dateKey, timezone).getTime();
  const to = zonedDateTime(shiftDateKey(dateKey, 1), timezone).getTime();
  const broadcasts: Broadcast[] = [];
  let current = broadcastAt(schedule, from);
  // 24 hours at the minimum validated duration (5 minutes), plus DST margin.
  while (new Date(current.startsAt).getTime() < to && broadcasts.length < 312) {
    if (new Date(current.endsAt).getTime() > from) broadcasts.push(current);
    current = nextBroadcast(schedule, current);
  }
  return broadcasts;
}

export function broadcastProgress(broadcast: Broadcast, timestamp: Date | number): number {
  const startsAt = timestampOf(broadcast.startsAt);
  const endsAt = timestampOf(broadcast.endsAt);
  return Math.min(1, Math.max(0, (timestampOf(timestamp) - startsAt) / (endsAt - startsAt)));
}

export function formatChannelTime(timestamp: Date | string | number, timezone: string): string {
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestampOf(timestamp)));
}

export function formatGuideDate(dateKey: string, timezone: string): string {
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(zonedDateTime(dateKey, timezone, 12));
}
