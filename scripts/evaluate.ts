// npm run evaluate [actuals.json]
// Scores every logged prediction (data/predictions.jsonl) against the actuals now known.

import { join, resolve } from 'node:path';
import { evaluateMonitoring } from '../src/forecast/monitor.js';
import { DEFAULT_PARAMS } from '../src/forecast/types.js';
import { readPredictionLog } from '../src/store.js';
import { fmt, pad, readInputFile } from './input.js';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const logPath = join(resolve(process.env.DATA_DIR ?? 'data'), 'predictions.jsonl');
const records = await readPredictionLog(logPath);
if (records.length === 0) {
  console.log(`No predictions logged yet (${logPath}). Call POST /predict first.`);
  process.exit(0);
}

const input = readInputFile(file);
console.log(`Actuals: ${input.path}`);
console.log(`Log: ${logPath} (${records.length} records)\n`);
console.log(
  `${pad('calculated_at', 24)}  ${pad('input end', 10)}  ${pad('weeks', 5, true)}  ${pad('WAPE', 7, true)}  ` +
    `${pad('bias', 7, true)}  ${pad('naive', 7, true)}  ${pad('expected', 8, true)}  drift  model`,
);
let evaluated = 0;
for (const record of records) {
  const threshold = Number(
    record.params.find((p) => p.name === 'drift_threshold')?.value ?? DEFAULT_PARAMS.driftThreshold,
  );
  const report = evaluateMonitoring([record], input.data, threshold);
  const end = record.input_end.timestamp.slice(0, 10);
  if (report.status !== 'evaluated') {
    // The record matched no newer actuals: the file ends at (or before) its input, or is another series.
    console.log(
      `${pad(record.calculated_at, 24)}  ${pad(end, 10)}  ${pad('-', 5, true)}  (no new actuals for this record)`,
    );
    continue;
  }
  evaluated++;
  console.log(
    `${pad(record.calculated_at, 24)}  ${pad(end, 10)}  ${pad(report.compared_weeks ?? 0, 5)}  ` +
      `${pad(fmt(report.realized_wape), 7, true)}  ${pad(fmt(report.realized_bias), 7, true)}  ` +
      `${pad(fmt(report.baseline_realized_wape), 7, true)}  ${pad(fmt(report.expected_wape), 8, true)}  ` +
      `${pad(report.drift ? 'YES' : 'no', 5)}  ${record.model}`,
  );
  for (const reason of report.drift_reasons) console.log(`    drift: ${reason}`);
}
console.log(`\n${evaluated} of ${records.length} predictions could be scored against the actuals.`);
