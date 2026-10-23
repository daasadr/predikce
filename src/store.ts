// State of the API: the last prediction in memory and on disk, and the prediction log
// (append-only, capped to the newest records).

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Diagnostics } from './forecast/pipeline.js';
import type { PredictionRecord } from './forecast/monitor.js';
import type { OutputPoint, ParamEntry } from './forecast/types.js';

export interface StoredPrediction {
  data: OutputPoint[];
  params: ParamEntry[];
  calculated_at: string;
  diagnostics: Diagnostics;
}

const LAST_PREDICTION_FILE = 'last-prediction.json';
const LOG_FILE = 'predictions.jsonl';
/** Monitoring only needs recent records; older ones are dropped so the log cannot grow without bound. */
export const MAX_LOG_RECORDS = 1000;

export class PredictionStore {
  private last: StoredPrediction | null = null;

  constructor(
    readonly dataDir: string,
    private readonly maxLogRecords = MAX_LOG_RECORDS,
  ) {}

  /** Restores the last prediction saved before a restart; a missing or corrupt file means none. */
  async load(): Promise<void> {
    try {
      this.last = JSON.parse(
        await readFile(join(this.dataDir, LAST_PREDICTION_FILE), 'utf8'),
      ) as StoredPrediction;
    } catch {
      this.last = null;
    }
  }

  getLast(): StoredPrediction | null {
    return this.last;
  }

  /** Atomic write (temporary file + rename) so a crash never leaves a half-written file. */
  async save(prediction: StoredPrediction): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const target = join(this.dataDir, LAST_PREDICTION_FILE);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(prediction), 'utf8');
    await rename(temporary, target);
    this.last = prediction;
  }

  /** Appends a record; when the log exceeds the cap it is rewritten (atomically) with the newest ones. */
  async appendRecord(record: PredictionRecord): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const path = join(this.dataDir, LOG_FILE);
    await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
    const lines = (await readFile(path, 'utf8')).split('\n').filter((line) => line.trim() !== '');
    if (lines.length > this.maxLogRecords) {
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, `${lines.slice(-this.maxLogRecords).join('\n')}\n`, 'utf8');
      await rename(temporary, path);
    }
  }

  async readRecords(): Promise<PredictionRecord[]> {
    return readPredictionLog(join(this.dataDir, LOG_FILE));
  }
}

/** Parses predictions.jsonl, skipping lines that are not valid JSON. */
export async function readPredictionLog(path: string): Promise<PredictionRecord[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as PredictionRecord];
      } catch {
        return [];
      }
    });
}
