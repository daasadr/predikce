// npm run backtest [file.json] [--full]
// Prints candidate × origin × WAPE/MAE/bias, the winner, interval coverage and extra experiments.

import { backtestOrigins, runBacktest } from '../src/forecast/evaluate.js';
import { fitRegression } from '../src/forecast/models/regression.js';
import { runForecast, type CandidateSummary } from '../src/forecast/pipeline.js';
import { nestedValidation, regressionGrid } from '../src/forecast/selection.js';
import { parseParams } from '../src/schemas.js';
import { buildWeeklySeries } from '../src/forecast/series.js';
import { fmt, pad, readInputFile } from './input.js';
import { writeForecastChart } from './chart.js';

const args = process.argv.slice(2);
const full = args.includes('--full');
const file = args.find((a) => !a.startsWith('--'));
const input = readInputFile(file);
const params = input.params.some((p) => p.name === 'interval_width')
  ? input.params
  : [...input.params, { name: 'interval_width', value: 0.75 }];

const started = performance.now();
const result = runForecast(input.data, params);
const elapsed = performance.now() - started;
const d = result.diagnostics;

console.log(`Input: ${input.path}`);
console.log(
  `Series: ${d.series.input_weeks} weeks (${d.series.first_week.slice(0, 10)} .. ${d.series.last_week.slice(0, 10)}), ` +
    `${d.series.missing_weeks} missing; forecast ${d.series.forecast_from.slice(0, 10)} .. ${d.series.forecast_to.slice(0, 10)}`,
);
console.log(`Computed in ${elapsed.toFixed(0)} ms\n`);

console.log('Backtest origins (first test week, training weeks, kind):');
for (const o of d.backtest.origins)
  console.log(`  ${o.first_test_week}  ${pad(o.train_weeks, 4)}  ${o.kind}`);

const origins = d.backtest.origins.map((o) => o.first_test_week);
const cell = (c: CandidateSummary, week: string) => {
  const o = c.per_origin.find((p) => p.first_test_week === week);
  return o ? `${fmt(o.wape, 1)}/${fmt(o.bias, 1)}` : '-';
};
const idWidth = Math.max(...d.backtest.candidates.map((c) => c.id.length), 10);

console.log('\nCandidates: mean WAPE %, MAE, bias %; per origin WAPE/bias % (sorted by mean WAPE)');
console.log(
  `${pad('candidate', idWidth)}  ${pad('cx', 3, true)}  ${pad('WAPE', 6, true)}  ${pad('MAE', 8, true)}  ${pad('bias', 6, true)}  ` +
    origins.map((w) => pad(w.slice(2), 11, true)).join(' '),
);
for (const c of d.backtest.candidates) {
  const marker = c.id === d.model.id ? ' <= winner' : '';
  console.log(
    `${pad(c.id, idWidth)}  ${pad(c.complexity, 3)}  ${pad(fmt(c.mean_wape), 6, true)}  ${pad(fmt(c.mean_mae, 0), 8, true)}  ` +
      `${pad(fmt(c.mean_bias), 6, true)}  ${origins.map((w) => pad(cell(c, w), 11, true)).join(' ')}${marker}`,
  );
}

if (full) {
  console.log('\nLong format: candidate × origin × WAPE / MAE / bias');
  for (const c of d.backtest.candidates) {
    for (const o of c.per_origin) {
      console.log(
        `${pad(c.id, idWidth)}  ${o.first_test_week}  ${pad(fmt(o.wape), 7, true)}  ${pad(fmt(o.mae), 9, true)}  ${pad(fmt(o.bias), 7, true)}`,
      );
    }
  }
}

const selected = d.backtest.selected;
const baseline = d.backtest.baseline;
console.log(`\nWinner: ${d.model.id}`);
console.log(`  reason: ${d.model.selection_reason}`);
if (selected && baseline) {
  console.log(
    `  mean WAPE ${fmt(selected.mean_wape)} %, MAE ${fmt(selected.mean_mae, 0)}, bias ${fmt(selected.mean_bias)} %`,
  );
  console.log(
    `  best naive baseline ${baseline.id}: WAPE ${fmt(baseline.mean_wape)} %, bias ${fmt(baseline.mean_bias)} %`,
  );
  const ok = selected.mean_wape <= baseline.mean_wape;
  console.log(`  winner is not worse than the naive baseline: ${ok ? 'YES' : 'NO'}`);
  console.log('  per origin (WAPE / MAE / bias):');
  for (const o of selected.per_origin) {
    console.log(
      `    ${o.first_test_week} ${pad(o.kind, 8)} ${pad(fmt(o.wape), 6, true)} % ${pad(fmt(o.mae, 0), 7, true)} ${pad(fmt(o.bias), 7, true)} %`,
    );
  }
}

if (d.intervals) {
  const i = d.intervals;
  console.log(
    `\nInterval coverage at width ${i.width}: ${fmt((i.coverage ?? NaN) * 100, 1)} % calibrated (leave-one-origin-out), ` +
      `${fmt((i.coverage_uncalibrated ?? NaN) * 100, 1)} % uncalibrated σ·√h; calibration factor ${fmt(i.calibration_factor, 3)}; ` +
      `${i.compared_weeks} weeks compared`,
  );
}

console.log('\nForecast:');
for (const p of result.data.slice(result.data.length - d.series.forecast_weeks)) {
  console.log(`  ${p.timestamp.slice(0, 10)}  ${pad(p.value, 8)}  [${p.lower ?? '-'} .. ${p.upper ?? '-'}]`);
}
if (d.warnings.length > 0) console.log(`\nWarnings:\n  ${d.warnings.join('\n  ')}`);

// Experiment: does Duan's smearing reduce the bias of log models? (Decision in docs/DECISIONS.md.)
const { params: parsed } = parseParams(params);
const { series } = buildWeeklySeries(input.data);
const backtestPoints = backtestOrigins(series.values.length, parsed);
const logCandidates = regressionGrid({ ...parsed, transform: 'log' }, series.values.length, []);
if (backtestPoints.length > 0 && logCandidates.length > 0) {
  let without = 0;
  let withSmearing = 0;
  let wapeWithout = 0;
  let wapeWith = 0;
  for (const c of logCandidates) {
    if (c.kind !== 'regression') continue;
    const a = runBacktest(series, backtestPoints, parsed.horizonWeeks, (t, h) =>
      fitRegression(t, c.config, h),
    );
    const b = runBacktest(series, backtestPoints, parsed.horizonWeeks, (t, h) =>
      fitRegression(t, { ...c.config, smearing: true }, h),
    );
    without += a.meanBias;
    withSmearing += b.meanBias;
    wapeWithout += a.meanWape;
    wapeWith += b.meanWape;
  }
  const k = logCandidates.length;
  console.log(
    `\nExperiment - Duan smearing on ${k} log candidates: mean bias ${fmt(without / k)} % -> ${fmt(withSmearing / k)} %, ` +
      `mean WAPE ${fmt(wapeWithout / k)} % -> ${fmt(wapeWith / k)} %`,
  );
}

// Nested validation: the selection itself is validated, which removes the optimism of choosing
// hyperparameters on the same origins that score them.
const nested = nestedValidation(series, parsed);
if (nested.length > 0) {
  const meanWape = nested.reduce((s, o) => s + o.metrics.wape, 0) / nested.length;
  const meanBias = nested.reduce((s, o) => s + o.metrics.bias, 0) / nested.length;
  console.log(
    `\nNested validation (selection rerun before each origin): mean WAPE ${fmt(meanWape)} %, bias ${fmt(meanBias)} %`,
  );
  for (const o of nested) {
    console.log(
      `  ${o.firstTestWeek}  WAPE ${pad(fmt(o.metrics.wape), 6, true)} %  bias ${pad(fmt(o.metrics.bias), 7, true)} %  ${o.chosen}`,
    );
  }
}

const chart = writeForecastChart(input.data, result, 'out/forecast.svg');
console.log(`\nChart: ${chart}`);
