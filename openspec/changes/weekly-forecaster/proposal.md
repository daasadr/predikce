# Proposal

## Why

FreshPoint potřebuje z minulých týdenních prodejů (v kusech) předpovědět prodeje na 10 týdnů dopředu a mít to dostupné jako jednoduché REST API v Node.js. Hodnotí se způsob přemýšlení a styl programování, ne dokonalá přesnost, proto stavíme **univerzální** prediktor pro libovolnou týdenní řadu s vlastní implementací predikčního jádra. Ukázková data (144 týdnů, růst ~400×, Vánoce, covid, odlehlé týdny) slouží jako testovací vzorek a ukazují, jak záludný vstup může být.

## What Changes

- Nová Node.js/TypeScript aplikace spustitelná lokálně přes `npm install && npm start` (žádný Vercel, Docker ani Python).
- REST API se dvěma endpointy: blokující `POST /predict` a `GET /prediction` (poslední výpočet, přežije restart).
- Validace a normalizace vstupu na týdenní mřížku (díry jako chybějící pozorování, ne nuly).
- Vlastní predikční jádro: vážená ridge regrese na log škále s po částech lineárním trendem, volitelnou Fourierovou sezónností a parametrizovaným kalendářem (CZ), robustní a recency váhy, intervaly predikce, naivní baseline.
- Rolling-origin backtest (WAPE, MAE, bias) s automatickým výběrem modelu z malé mřížky kandidátů a pojistkou proti podlezení naivní baseline.
- Monitoring realizované přesnosti dřívějších predikcí a varování před driftem (bez nových endpointů).
- Skripty `npm run backtest` a `npm run evaluate`, dokumentace v češtině (README, docs/DECISIONS.md, docs/APPROACHES.md).

## Capabilities

### New Capabilities
- `forecast-api`: HTTP rozhraní `POST /predict` a `GET /prediction`, formát odpovědí a chyb, persistence posledního výpočtu.
- `series-input`: validace vstupu, parametry, týdenní mřížka, chybějící týdny a limity délky řady.
- `forecast-model`: predikční jádro (transformace, trend se zlomy, sezónnost, kalendář, váhy, ridge, intervaly, naivní modely) a jeho numerické záruky.
- `model-selection`: metriky, rolling-origin backtest, mřížka kandidátů, pravidlo výběru a skript `backtest`.
- `prediction-monitoring`: záznam predikcí, realizovaná přesnost, varování před driftem a skript `evaluate`.
- `project-constraints`: allowlist závislostí, determinismus, zákaz volání LLM a datově specifických konstant.

### Modified Capabilities
<!-- Žádné, projekt začíná od nuly. -->

## Impact

- Nový kód v `src/`, `scripts/`, `tests/`; závislosti `fastify` a `zod` (produkční), vývojové nástroje podle allowlistu.
- Runtime soubory `data/last-prediction.json` a `data/predictions.jsonl` (mimo git).
- Ukázková data `data/weekly-sales.json` slouží jen jako fixture testů a vstup skriptů, v kódu nejsou žádná data ani data-specifické konstanty.
