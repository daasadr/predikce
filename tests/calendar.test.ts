import { describe, expect, it } from 'vitest';
import { easterSunday, holidaysOfYear, weekCalendarFeatures } from '../src/forecast/calendar.js';

const day = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe('easterSunday (anonymous Gregorian algorithm)', () => {
  it.each([
    [2019, '2019-04-21'],
    [2020, '2020-04-12'],
    [2021, '2021-04-04'],
    [2024, '2024-03-31'],
    [2000, '2000-04-23'],
    [2038, '2038-04-25'],
  ])('year %i -> %s', (year, expected) => {
    expect(isoDate(easterSunday(year))).toBe(expected);
  });
});

describe('Czech public holidays', () => {
  it('include Good Friday and Easter Monday', () => {
    const holidays = holidaysOfYear('CZ', 2021).map(isoDate);
    expect(holidays).toContain('2021-04-02');
    expect(holidays).toContain('2021-04-05');
    expect(holidays).toContain('2021-07-05');
    expect(holidays).toContain('2021-12-24');
    expect(holidays).toHaveLength(13);
  });

  it('do not include Good Friday before it became a holiday', () => {
    expect(holidaysOfYear('CZ', 2015).map(isoDate)).not.toContain('2015-04-03');
  });
});

describe('weekCalendarFeatures', () => {
  it('week of 2020-12-28 contains 1 January, week of 2021-01-04 does not', () => {
    expect(weekCalendarFeatures('CZ', day('2020-12-28')).containsNewYear).toBe(true);
    expect(weekCalendarFeatures('CZ', day('2021-01-04')).containsNewYear).toBe(false);
  });

  it('week of 2020-12-21 contains 24 December', () => {
    const f = weekCalendarFeatures('CZ', day('2020-12-21'));
    expect(f.containsChristmasEve).toBe(true);
    expect(f.containsNewYear).toBe(false);
    // Mon 21, Tue 22, Wed 23 are working days; 24-26 Dec are holidays.
    expect(f.workingDays).toBe(3);
  });

  it('counts working days without holidays and weekends', () => {
    expect(weekCalendarFeatures('CZ', day('2021-06-14')).workingDays).toBe(5);
    // Week with Good Friday 2021-04-02.
    expect(weekCalendarFeatures('CZ', day('2021-03-29')).workingDays).toBe(4);
    // 5 and 6 July 2021 fall on Monday and Tuesday.
    expect(weekCalendarFeatures('CZ', day('2021-07-05')).workingDays).toBe(3);
  });

  it('works for weeks that do not start on Monday', () => {
    // Sunday 2020-12-27 .. Saturday 2021-01-02: working days Mon-Thu, Friday 1 Jan is a holiday.
    const f = weekCalendarFeatures('CZ', day('2020-12-27'));
    expect(f.workingDays).toBe(4);
    expect(f.containsNewYear).toBe(true);
  });
});
