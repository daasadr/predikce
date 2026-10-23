// Calendar rules selected by the `calendar` parameter. Only general, documented rules live here;
// nothing is derived from any particular data set.

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

export type CalendarName = 'CZ';

interface FixedHoliday {
  month: number; // 1-12
  day: number;
}

interface EasterHoliday {
  offsetDays: number; // relative to Easter Sunday
  sinceYear?: number;
}

interface CalendarDefinition {
  fixed: FixedHoliday[];
  easter: EasterHoliday[];
}

const CALENDARS: Record<CalendarName, CalendarDefinition> = {
  // Czech public holidays (zákon č. 245/2000 Sb.); Good Friday since 2016.
  CZ: {
    fixed: [
      { month: 1, day: 1 },
      { month: 5, day: 1 },
      { month: 5, day: 8 },
      { month: 7, day: 5 },
      { month: 7, day: 6 },
      { month: 9, day: 28 },
      { month: 10, day: 28 },
      { month: 11, day: 17 },
      { month: 12, day: 24 },
      { month: 12, day: 25 },
      { month: 12, day: 26 },
    ],
    easter: [{ offsetDays: -2, sinceYear: 2016 }, { offsetDays: 1 }],
  },
};

export function isCalendarName(value: string): value is CalendarName {
  return Object.hasOwn(CALENDARS, value);
}

/** Easter Sunday (UTC midnight, ms) by the anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

const holidayCache = new Map<string, Set<number>>();

/** Public holidays of a year as UTC-midnight timestamps, sorted. */
export function holidaysOfYear(calendar: CalendarName, year: number): number[] {
  return [...holidaySet(calendar, year)].sort((x, y) => x - y);
}

function holidaySet(calendar: CalendarName, year: number): Set<number> {
  const key = `${calendar}:${year}`;
  let set = holidayCache.get(key);
  if (!set) {
    const definition = CALENDARS[calendar];
    const easter = easterSunday(year);
    set = new Set([
      ...definition.fixed.map((h) => Date.UTC(year, h.month - 1, h.day)),
      ...definition.easter
        .filter((h) => h.sinceYear === undefined || year >= h.sinceYear)
        .map((h) => easter + h.offsetDays * DAY_MS),
    ]);
    holidayCache.set(key, set);
  }
  return set;
}

export interface WeekCalendarFeatures {
  /** Monday-Friday days of the 7-day week that are not public holidays. */
  workingDays: number;
  containsChristmasEve: boolean;
  containsNewYear: boolean;
}

/**
 * Features of the 7-day week starting at `weekStart` (the timestamp is treated as the first day of
 * the week). Rules use calendar dates, never ISO week numbers.
 */
export function weekCalendarFeatures(calendar: CalendarName, weekStart: number): WeekCalendarFeatures {
  const start = Math.floor(weekStart / DAY_MS) * DAY_MS;
  let workingDays = 0;
  let containsChristmasEve = false;
  let containsNewYear = false;
  for (let i = 0; i < 7; i++) {
    const date = new Date(start + i * DAY_MS);
    const month = date.getUTCMonth() + 1;
    const dayOfMonth = date.getUTCDate();
    const weekday = date.getUTCDay(); // 0 = Sunday
    if (month === 12 && dayOfMonth === 24) containsChristmasEve = true;
    if (month === 1 && dayOfMonth === 1) containsNewYear = true;
    const isWeekend = weekday === 0 || weekday === 6;
    if (!isWeekend && !holidaySet(calendar, date.getUTCFullYear()).has(date.getTime())) workingDays++;
  }
  return { workingDays, containsChristmasEve, containsNewYear };
}
