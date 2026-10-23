import { describe, expect, it } from 'vitest';
import { DAY_MS, WEEK_MS } from '../src/forecast/calendar.js';
import { changepointLocations, fourierTerms, hinge, YEAR_DAYS } from '../src/forecast/design.js';
import { fitRegression, type RegressionConfig } from '../src/forecast/models/regression.js';
import type { WeeklySeries } from '../src/forecast/series.js';

const START = Date.UTC(2021, 0, 4);

const series = (values: (number | null)[], start = START): WeeklySeries => ({
  times: values.map((_, i) => start + i * WEEK_MS),
  values,
  inputIndex: values.flatMap((v, i) => (v === null ? [] : [i])),
  missingCount: values.filter((v) => v === null).length,
});

const config = (overrides: Partial<RegressionConfig> = {}): RegressionConfig => ({
  transform: 'log',
  halfLifeWeeks: null,
  fourierOrder: 0,
  calendar: 'none',
  robust: false,
  changepointPriorScale: 0.5,
  changepointRange: 0.8,
  nChangepoints: 10,
  seasonality: 'local',
  smearing: false,
  ...overrides,
});

const growth = (n: number, rate = 1.02, base = 1000) => Array.from({ length: n }, (_, t) => base * rate ** t);

describe('design', () => {
  it('hinge for s_k = 100 is 0 at t=90, 0 at t=100 and 10 at t=110', () => {
    expect(hinge(90, 100)).toBe(0);
    expect(hinge(100, 100)).toBe(0);
    expect(hinge(110, 100)).toBe(10);
  });

  it('Fourier terms are periodic with a period of one year', () => {
    const t = Date.UTC(2020, 2, 16);
    const a = fourierTerms(t, 3);
    const b = fourierTerms(t + YEAR_DAYS * DAY_MS, 3);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
    expect(a).toHaveLength(6);
  });

  it('places changepoints uniformly in the first part of the history', () => {
    const cps = changepointLocations(100, 4, 0.8);
    expect(cps).toHaveLength(4);
    expect(cps[cps.length - 1]).toBeCloseTo(79, 9);
    expect(cps[1] - cps[0]).toBeCloseTo(cps[3] - cps[2], 9);
    // Every changepoint must have data after it.
    expect(changepointLocations(3, 10, 0.8)).toEqual([1]);
    expect(changepointLocations(2, 10, 0.8)).toEqual([]);
  });
});

describe('fitRegression', () => {
  it('extrapolates exact log-linear growth', () => {
    const values = growth(60);
    const f = fitRegression(series(values), config(), 10);
    f.mean.forEach((m, h) => expect(m / (1000 * 1.02 ** (60 + h)) - 1).toBeCloseTo(0, 2));
    expect(f.fitted).toHaveLength(60);
  });

  it('treats a missing week as missing, not as zero', () => {
    const values: (number | null)[] = growth(60);
    const full = fitRegression(series(values), config(), 10);
    values[40] = null;
    const gap = fitRegression(series(values), config(), 10);
    values[40] = 0;
    const zero = fitRegression(series(values), config(), 10);
    gap.mean.forEach((m, h) => expect(m / full.mean[h] - 1).toBeCloseTo(0, 3));
    expect(Math.abs(zero.mean[0] / full.mean[0] - 1)).toBeGreaterThan(0.01);
  });

  it('robust weights damp an outlying week', () => {
    const clean = growth(80);
    const dirty = [...clean];
    dirty[70] = clean[70] / 10;
    const reference = fitRegression(series(clean), config({ robust: true }), 10);
    const robust = fitRegression(series(dirty), config({ robust: true }), 10);
    const plain = fitRegression(series(dirty), config({ robust: false }), 10);
    const outlierWeek = new Date(START + 70 * WEEK_MS).toISOString().slice(0, 10);
    const downweighted = robust.details.downweighted_weeks as { week: string; weight: number }[];
    expect(downweighted.find((d) => d.week === outlierWeek)?.weight).toBeLessThan(0.2);
    expect(Math.abs(robust.mean[0] / reference.mean[0] - 1)).toBeLessThan(0.02);
    expect(Math.abs(plain.mean[0] / reference.mean[0] - 1)).toBeGreaterThan(
      Math.abs(robust.mean[0] / reference.mean[0] - 1),
    );
  });

  it('recency weights follow a recent change of slope', () => {
    const values = [...growth(60, 1.03), ...growth(40, 1.0, 1000 * 1.03 ** 60)];
    const recent = fitRegression(series(values), config({ halfLifeWeeks: 8, nChangepoints: 0 }), 5);
    const flat = fitRegression(series(values), config({ halfLifeWeeks: null, nChangepoints: 0 }), 5);
    const last = values[values.length - 1];
    expect(Math.abs(recent.mean[4] / last - 1)).toBeLessThan(Math.abs(flat.mean[4] / last - 1));
  });

  it('two-stage seasonality estimates the yearly profile from the whole history', () => {
    // Three years of yearly seasonality (±20 %) on a linear level.
    const n = 160;
    const truth = (t: number) => (1000 + 5 * t) * (1 + 0.2 * Math.sin((2 * Math.PI * t * 7) / YEAR_DAYS));
    const values = Array.from({ length: n }, (_, t) => truth(t));
    const f = fitRegression(
      series(values),
      config({ fourierOrder: 2, halfLifeWeeks: 8, seasonality: 'two_stage' }),
      10,
    );
    // Peak-to-trough on the log scale: ln(1.2) − ln(0.8) ≈ 0.405.
    expect(f.details.seasonal_profile_amplitude as number).toBeCloseTo(Math.log(1.2 / 0.8), 1);
    f.mean.forEach((m, h) => expect(Math.abs(m / truth(n + h) - 1)).toBeLessThan(0.03));
  });

  it('turns seasonality off for short history with a warning', () => {
    const f = fitRegression(series(growth(80)), config({ fourierOrder: 2 }), 10);
    expect(f.warnings.join(' ')).toMatch(/104 weeks/);
    expect(f.details.effective_fourier_order).toBe(0);
  });

  it('warns when a calendar event never occurs in the history', () => {
    // 20 weeks from February to June: no Christmas, no New Year.
    const f = fitRegression(series(growth(20), Date.UTC(2021, 1, 1)), config({ calendar: 'CZ' }), 10);
    const text = f.warnings.join(' ');
    expect(text).toMatch(/24 December/);
    expect(text).toMatch(/1 January/);
    expect(f.mean.every(Number.isFinite)).toBe(true);
  });

  it('learns a calendar effect that occurs in the history', () => {
    // Sales drop by half in weeks containing 24 December.
    const n = 160;
    const times = Array.from({ length: n }, (_, i) => START + i * WEEK_MS);
    const values = times.map((t, i) => {
      const d = new Date(t);
      const xmas = [0, 1, 2, 3, 4, 5, 6].some((k) => {
        const day = new Date(t + k * DAY_MS);
        return day.getUTCMonth() === 11 && day.getUTCDate() === 24;
      });
      return 1000 * 1.005 ** i * (xmas ? 0.5 : 1) + (d.getUTCDate() % 3);
    });
    const f = fitRegression(series(values), config({ calendar: 'CZ', robust: false }), 10);
    const columns = f.details.columns as { name: string; coefficient: number }[];
    const working = columns.find((c) => c.name === 'working_days')!.coefficient;
    const christmas = columns.find((c) => c.name === 'christmas_week')!.coefficient;
    // Christmas week has 3 working days: total log effect ≈ ln(0.5).
    expect(working * Math.log(3 / 5) + christmas).toBeCloseTo(Math.log(0.5), 1);
  });

  it('handles a constant series', () => {
    const f = fitRegression(series(new Array(60).fill(500)), config({ robust: true, halfLifeWeeks: 13 }), 10);
    f.mean.forEach((m) => expect(m).toBeCloseTo(500, 6));
    expect(f.fitted.every(Number.isFinite)).toBe(true);
  });

  it('handles zeros and huge values without NaN or Infinity', () => {
    const values = growth(60).map((v, i) => (i % 7 === 0 ? 0 : v * 1e9));
    for (const transform of ['log', 'none'] as const) {
      const f = fitRegression(series(values), config({ transform, robust: true, calendar: 'CZ' }), 10);
      expect([...f.mean, ...f.fitted, ...f.intervalSigma].every(Number.isFinite)).toBe(true);
      expect(f.mean.every((m) => m >= 0)).toBe(true);
    }
  });
});
