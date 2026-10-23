import { z } from 'zod';
import { isCalendarName } from './forecast/calendar.js';
import {
  DEFAULT_PARAMS,
  InvalidInputError,
  type ForecastParams,
  type InputPoint,
  type ParamEntry,
} from './forecast/types.js';

const paramSchema = z.object({
  name: z.string().min(1),
  value: z.union([z.number(), z.string()]),
});

const pointSchema = z.object({
  timestamp: z.string(),
  value: z.number(),
});

const bodySchema = z.object({
  params: z.array(paramSchema).optional(),
  data: z.array(pointSchema).min(1, 'data must contain at least one point'),
});

export interface PredictBody {
  params: ParamEntry[];
  data: InputPoint[];
}

export function parsePredictBody(body: unknown): PredictBody {
  const result = bodySchema.safeParse(body);
  if (!result.success) {
    throw new InvalidInputError(
      'Request body does not match { params?: [{name, value}], data: [{timestamp, value}] }',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return { params: result.data.params ?? [], data: result.data.data };
}

type ParamSetter = (value: number | string, params: ForecastParams) => string | null;

function asNumber(value: number | string): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(trimmed)) return null;
  return Number(trimmed);
}

function integerIn(min: number, max: number, set: (params: ForecastParams, v: number) => void): ParamSetter {
  return (raw, params) => {
    const v = asNumber(raw);
    if (v === null || !Number.isInteger(v) || v < min || v > max)
      return `must be an integer in [${min}, ${max}]`;
    set(params, v);
    return null;
  };
}

function numberIn(
  check: (v: number) => boolean,
  description: string,
  set: (params: ForecastParams, v: number) => void,
): ParamSetter {
  return (raw, params) => {
    const v = asNumber(raw);
    if (v === null || !check(v)) return `must be ${description}`;
    set(params, v);
    return null;
  };
}

function oneOf<T extends string>(
  options: readonly T[],
  set: (params: ForecastParams, v: T) => void,
  normalise: (s: string) => string = (s) => s.toLowerCase(),
): ParamSetter {
  return (raw, params) => {
    const v = typeof raw === 'string' ? normalise(raw.trim()) : '';
    const match = options.find((o) => o === v);
    if (match === undefined) return `must be one of ${options.join(', ')}`;
    set(params, match);
    return null;
  };
}

const PARAM_SETTERS: Record<string, ParamSetter> = {
  horizon_weeks: integerIn(1, 520, (p, v) => (p.horizonWeeks = v)),
  interval_width: numberIn(
    (v) => v >= 0 && v < 1,
    'a number in [0, 1)',
    (p, v) => (p.intervalWidth = v),
  ),
  model: oneOf(['auto', 'naive', 'trend', 'seasonal'] as const, (p, v) => (p.model = v)),
  transform: oneOf(['log', 'none'] as const, (p, v) => (p.transform = v)),
  changepoint_prior_scale: numberIn(
    (v) => v > 0,
    'a positive number',
    (p, v) => (p.changepointPriorScale = v),
  ),
  changepoint_range: numberIn(
    (v) => v > 0 && v <= 1,
    'a number in (0, 1]',
    (p, v) => (p.changepointRange = v),
  ),
  n_changepoints: integerIn(0, 100, (p, v) => (p.nChangepoints = v)),
  recency_half_life_weeks: (raw, params) => {
    if (typeof raw === 'string' && ['auto', 'none'].includes(raw.trim().toLowerCase())) {
      params.recencyHalfLifeWeeks = raw.trim().toLowerCase() === 'none' ? 'none' : null;
      return null;
    }
    const v = asNumber(raw);
    if (v === null || v <= 0) return 'must be auto, none or a positive number of weeks';
    params.recencyHalfLifeWeeks = v;
    return null;
  },
  fourier_order: (raw, params) => {
    if (typeof raw === 'string' && raw.trim().toLowerCase() === 'auto') {
      params.fourierOrder = null;
      return null;
    }
    const v = asNumber(raw);
    if (v === null || !Number.isInteger(v) || v < 0 || v > 3) return 'must be auto or an integer in [0, 3]';
    params.fourierOrder = v;
    return null;
  },
  calendar: (raw, params) => {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (v.toLowerCase() === 'none') params.calendar = 'none';
    else if (isCalendarName(v.toUpperCase())) params.calendar = v.toUpperCase() as ForecastParams['calendar'];
    else return 'must be CZ or none';
    return null;
  },
  seasonality: (raw, params) => {
    const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (v === 'auto') params.seasonality = null;
    else if (v === 'local' || v === 'two_stage') params.seasonality = v;
    else return 'must be auto, local or two_stage';
    return null;
  },
  history_fit: oneOf(['blend', 'model'] as const, (p, v) => (p.historyFit = v)),
  robust: (raw, params) => {
    const v = asNumber(raw);
    if (v !== 0 && v !== 1) return 'must be 0 or 1';
    params.robust = v === 1;
    return null;
  },
  backtest_origins: integerIn(0, 50, (p, v) => (p.backtestOrigins = v)),
  backtest_step: integerIn(1, 520, (p, v) => (p.backtestStep = v)),
  min_train_weeks: integerIn(4, 5200, (p, v) => (p.minTrainWeeks = v)),
  selection_tolerance: numberIn(
    (v) => v >= 0 && v <= 1,
    'a number in [0, 1]',
    (p, v) => (p.selectionTolerance = v),
  ),
  drift_threshold: numberIn(
    (v) => v > 0,
    'a positive number',
    (p, v) => (p.driftThreshold = v),
  ),
};

export const KNOWN_PARAM_NAMES = Object.keys(PARAM_SETTERS);

export function parseParams(entries: ParamEntry[]): { params: ForecastParams; warnings: string[] } {
  const params: ForecastParams = { ...DEFAULT_PARAMS };
  const warnings: string[] = [];
  const details: { param: string; message: string }[] = [];
  const seen = new Set<string>();
  for (const { name, value } of entries) {
    if (seen.has(name)) {
      details.push({ param: name, message: 'is given more than once' });
      continue;
    }
    seen.add(name);
    const setter = PARAM_SETTERS[name];
    if (!setter) {
      warnings.push(`Unknown parameter "${name}" was ignored.`);
      continue;
    }
    const error = setter(value, params);
    if (error) details.push({ param: name, message: `${name} ${error}` });
  }
  if (details.length > 0) throw new InvalidInputError('Invalid params', details);
  return { params, warnings };
}
