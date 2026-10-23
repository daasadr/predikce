import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateMonitoring, type PredictionRecord } from './forecast/monitor.js';
import { runForecast } from './forecast/pipeline.js';
import { InvalidInputError, UnprocessableSeriesError } from './forecast/types.js';
import { parseParams, parsePredictBody } from './schemas.js';
import { PredictionStore, type StoredPrediction } from './store.js';

export interface ServerOptions {
  dataDir: string;
  /** Cap of data/predictions.jsonl (default MAX_LOG_RECORDS). */
  maxLogRecords?: number;
  logger?: boolean;
  /** Clock for calculated_at; injectable for tests. */
  now?: () => Date;
}

const BODY_LIMIT_BYTES = 10 * 1024 * 1024;

interface ErrorBody {
  error: string;
  message: string;
  details: unknown[];
}

const errorBody = (error: string, message: string, details: unknown[] = []): ErrorBody => ({
  error,
  message,
  details,
});

const CLIENT_ERROR_CODES: Record<number, string> = {
  400: 'invalid_input',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
};

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const store = new PredictionStore(options.dataDir, options.maxLogRecords);
  await store.load();
  const now = options.now ?? (() => new Date());
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: BODY_LIMIT_BYTES });

  app.post('/predict', async (request, reply) => {
    const body = parsePredictBody(request.body);
    const result = runForecast(body.data, body.params);
    const calculatedAt = now().toISOString();

    const { params } = parseParams(body.params);
    const monitoring = evaluateMonitoring(await store.readRecords(), body.data, params.driftThreshold);
    const warnings = [...result.diagnostics.warnings];
    if (monitoring.drift) warnings.push(`Drift warning: ${monitoring.drift_reasons.join('; ')}.`);
    const stored: StoredPrediction = {
      data: result.data,
      params: result.params,
      calculated_at: calculatedAt,
      diagnostics: { ...result.diagnostics, warnings, monitoring },
    };

    const lastInput = body.data.reduce((a, b) =>
      Date.parse(a.timestamp) >= Date.parse(b.timestamp) ? a : b,
    );
    const record: PredictionRecord = {
      calculated_at: calculatedAt,
      params: result.params,
      model: result.diagnostics.model.id,
      expected_wape: result.diagnostics.backtest.selected?.mean_wape ?? null,
      input_end: { timestamp: lastInput.timestamp, value: lastInput.value },
      input_weeks: result.diagnostics.series.input_weeks,
      forecast: result.data.slice(result.data.length - result.diagnostics.series.forecast_weeks),
      baseline_forecast: result.baselineForecast,
    };
    await store.save(stored);
    await store.appendRecord(record);
    return reply.code(200).send({ data: result.data });
  });

  app.get('/prediction', async (_request, reply) => {
    const last = store.getLast();
    if (last === null) {
      return reply
        .code(404)
        .send(errorBody('not_found', 'No prediction has been calculated yet; call POST /predict.'));
    }
    return reply.code(200).send(last);
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send(
        errorBody(
          'not_found',
          `Route ${request.method} ${request.url} does not exist. Use POST /predict or GET /prediction.`,
        ),
      );
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof InvalidInputError) {
      return reply.code(400).send(errorBody('invalid_input', error.message, error.details));
    }
    if (error instanceof UnprocessableSeriesError) {
      return reply.code(422).send(errorBody(error.code, error.message, error.details));
    }
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send(errorBody(CLIENT_ERROR_CODES[status] ?? 'invalid_input', error.message));
    }
    request.log.error(error);
    return reply
      .code(500)
      .send(errorBody('internal_error', 'Unexpected error while calculating the prediction.'));
  });

  return app;
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? 'localhost';
  const dataDir = resolve(process.env.DATA_DIR ?? 'data');
  const app = await buildServer({ dataDir, logger: true });
  await app.listen({ port, host });
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
