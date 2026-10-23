// SVG chart of actual sales, fitted model, forecast and its interval (written by npm run backtest).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ForecastResult } from '../src/forecast/pipeline.js';
import type { InputPoint } from '../src/forecast/types.js';

const WIDTH = 960;
const HEIGHT = 440;
const MARGIN = { top: 56, right: 24, bottom: 40, left: 64 };

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function niceStep(range: number, ticks: number): number {
  const raw = range / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  return (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;
}

export function writeForecastChart(input: InputPoint[], result: ForecastResult, path: string): string {
  const actual = input.map((p) => ({ t: Date.parse(p.timestamp), v: p.value })).sort((a, b) => a.t - b.t);
  const points = result.data.map((p) => ({ t: Date.parse(p.timestamp), ...p }));
  const forecastWeeks = result.diagnostics.series.forecast_weeks;
  const fitted = points.slice(0, points.length - forecastWeeks);
  const forecast = points.slice(points.length - forecastWeeks);

  const tMin = Math.min(actual[0].t, points[0].t);
  const tMax = points[points.length - 1].t;
  const yMaxData = Math.max(...actual.map((p) => p.v), ...points.map((p) => p.upper ?? p.value));
  const step = niceStep(yMaxData || 1, 5);
  const yMax = Math.ceil((yMaxData || 1) / step) * step;
  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (t: number) => MARGIN.left + ((t - tMin) / Math.max(tMax - tMin, 1)) * plotW;
  const y = (v: number) => MARGIN.top + plotH - (v / yMax) * plotH;
  const line = (ps: { t: number; v: number }[]) =>
    ps.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');

  const gridLines: string[] = [];
  for (let v = 0; v <= yMax; v += step) {
    gridLines.push(
      `<line class="grid" x1="${MARGIN.left}" x2="${WIDTH - MARGIN.right}" y1="${y(v)}" y2="${y(v)}"/>` +
        `<text class="tick" x="${MARGIN.left - 8}" y="${y(v) + 4}" text-anchor="end">${v.toLocaleString('en-US')}</text>`,
    );
  }
  const xTicks: string[] = [];
  const firstYear = new Date(tMin).getUTCFullYear();
  const lastYear = new Date(tMax).getUTCFullYear();
  for (let year = firstYear; year <= lastYear; year++) {
    for (const month of [0, 6]) {
      const t = Date.UTC(year, month, 1);
      if (t < tMin || t > tMax) continue;
      xTicks.push(
        `<line class="axis" x1="${x(t)}" x2="${x(t)}" y1="${MARGIN.top + plotH}" y2="${MARGIN.top + plotH + 4}"/>` +
          `<text class="tick" x="${x(t)}" y="${MARGIN.top + plotH + 18}" text-anchor="middle">${year}-${month === 0 ? '01' : '07'}</text>`,
      );
    }
  }

  const hasBand = forecast.every((p) => p.lower !== undefined && p.upper !== undefined);
  const band = hasBand
    ? `M${forecast.map((p) => `${x(p.t).toFixed(1)},${y(p.upper!).toFixed(1)}`).join('L')}` +
      `L${[...forecast]
        .reverse()
        .map((p) => `${x(p.t).toFixed(1)},${y(p.lower!).toFixed(1)}`)
        .join('L')}Z`
    : '';
  const lastFitted = fitted[fitted.length - 1];
  const model = [...fitted, ...forecast].map((p) => ({ t: p.t, v: p.value }));
  const forecastStart = x(forecast[0].t);
  const width = result.diagnostics.intervals?.width ?? 0;

  const tooltips = forecast
    .map(
      (p) =>
        `<circle class="hit" cx="${x(p.t)}" cy="${y(p.value)}" r="8"><title>${p.timestamp.slice(0, 10)}: forecast ${p.value}` +
        `${hasBand ? ` (${p.lower} – ${p.upper})` : ''}</title></circle>`,
    )
    .join('');
  const actualHits = actual
    .map(
      (p) =>
        `<circle class="hit" cx="${x(p.t)}" cy="${y(p.v)}" r="6"><title>${new Date(p.t).toISOString().slice(0, 10)}: actual ${p.v}</title></circle>`,
    )
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-labelledby="title desc">
<title id="title">Weekly sales: actuals, model fit and ${forecastWeeks}-week forecast</title>
<desc id="desc">${escape(result.diagnostics.model.id)}</desc>
<style>
  svg { --surface: #fcfcfb; --text-primary: #0b0b0b; --text-secondary: #52514e; --grid: #e4e3df; --actual: #2a78d6; --model: #eb6834; font-family: system-ui, sans-serif; }
  @media (prefers-color-scheme: dark) { svg { --surface: #1a1a19; --text-primary: #f0efec; --text-secondary: #c3c2b7; --grid: #3a3936; --actual: #3987e5; --model: #d95926; } }
  .bg { fill: var(--surface); }
  .grid { stroke: var(--grid); stroke-width: 1; }
  .axis { stroke: var(--text-secondary); stroke-width: 1; }
  .tick { fill: var(--text-secondary); font-size: 11px; }
  .label { fill: var(--text-primary); font-size: 12px; }
  .title { fill: var(--text-primary); font-size: 15px; font-weight: 600; }
  .actual { fill: none; stroke: var(--actual); stroke-width: 2; stroke-linejoin: round; }
  .model { fill: none; stroke: var(--model); stroke-width: 2; stroke-linejoin: round; }
  .forecast { fill: none; stroke: var(--model); stroke-width: 2; stroke-dasharray: 5 3; }
  .band { fill: var(--model); fill-opacity: 0.18; }
  .divider { stroke: var(--text-secondary); stroke-width: 1; stroke-dasharray: 2 3; }
  .hit { fill: transparent; }
  .hit:hover { fill: var(--text-primary); fill-opacity: 0.25; }
</style>
<rect class="bg" width="${WIDTH}" height="${HEIGHT}"/>
<text class="title" x="${MARGIN.left}" y="22">Weekly sales and ${forecastWeeks}-week forecast</text>
<g transform="translate(${MARGIN.left},38)">
  <line class="actual" x1="0" x2="18" y1="0" y2="0"/><text class="label" x="24" y="4">Actual sales</text>
  <line class="model" x1="120" x2="138" y1="0" y2="0"/><text class="label" x="144" y="4">Fitted history</text>
  <line class="forecast" x1="256" x2="274" y1="0" y2="0"/><text class="label" x="280" y="4">Forecast</text>
  ${hasBand ? `<rect class="band" x="352" y="-6" width="18" height="12"/><text class="label" x="376" y="4">${Math.round(width * 100)} % interval</text>` : ''}
</g>
${gridLines.join('\n')}
<line class="axis" x1="${MARGIN.left}" x2="${WIDTH - MARGIN.right}" y1="${MARGIN.top + plotH}" y2="${MARGIN.top + plotH}"/>
${xTicks.join('\n')}
<line class="divider" x1="${forecastStart}" x2="${forecastStart}" y1="${MARGIN.top}" y2="${MARGIN.top + plotH}"/>
${hasBand ? `<path class="band" d="${band}"/>` : ''}
<path class="actual" d="${line(actual)}"/>
<path class="model" d="${line(model.slice(0, fitted.length))}"/>
<path class="forecast" d="${line([{ t: lastFitted.t, v: lastFitted.value }, ...forecast.map((p) => ({ t: p.t, v: p.value }))])}"/>
${actualHits}
${tooltips}
</svg>
`;
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, svg, 'utf8');
  return absolute;
}
