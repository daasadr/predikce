import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InputPoint } from '../src/forecast/types.js';

const WEEK_MS = 7 * 86_400_000;

/** Sample data shipped with the task (array of points or { data: [...] }). */
export function loadSampleData(): InputPoint[] {
  const raw = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'data', 'weekly-sales.json'), 'utf8'),
  ) as InputPoint[] | { data: InputPoint[] };
  return Array.isArray(raw) ? raw : raw.data;
}

export function weeklyPoints(start: string, values: number[]): InputPoint[] {
  return values.map((value, i) => ({
    timestamp: new Date(Date.parse(start) + i * WEEK_MS).toISOString(),
    value,
  }));
}
