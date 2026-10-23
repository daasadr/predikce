import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { InputPoint, ParamEntry } from '../src/forecast/types.js';

export const DEFAULT_INPUT = 'data/weekly-sales.json';

/** Reads an input file: an array of points or a POST /predict body ({ params?, data }). */
export function readInputFile(path = DEFAULT_INPUT): {
  data: InputPoint[];
  params: ParamEntry[];
  path: string;
} {
  const absolute = resolve(path);
  const raw = JSON.parse(readFileSync(absolute, 'utf8')) as
    InputPoint[] | { data: InputPoint[]; params?: ParamEntry[] };
  return Array.isArray(raw)
    ? { data: raw, params: [], path: absolute }
    : { data: raw.data, params: raw.params ?? [], path: absolute };
}

export function pad(value: string | number, width: number, alignRight = typeof value === 'number'): string {
  const text = String(value);
  return alignRight ? text.padStart(width) : text.padEnd(width);
}

export const fmt = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value) ? '-' : value.toFixed(digits);
