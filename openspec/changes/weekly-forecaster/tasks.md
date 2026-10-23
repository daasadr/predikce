# Tasks

## 1. P0 – Kostra projektu

- [x] 1.1 Založit package.json, tsconfig, eslint, prettier, vitest a skripty (start, dev, build, test, typecheck, lint, backtest, evaluate); ověřit, že `npm run typecheck`, `npm run lint` a `npm test` proběhnou
- [x] 1.2 Test dependency guard a kontrola zdrojů (žádné LLM, žádné letopočty mimo kalendář); ověřit, že test projde a selže při přidání nepovolené závislosti
- [x] 1.3 Hooks v .claude/settings.json (po úpravě typecheck + lint, při ukončení testy); ověřit ručním spuštěním hook skriptů
- [x] 1.4 Ukázková data `data/weekly-sales.json`; ověřit 144 týdnů od 2018-09-24 do 2021-06-21

## 2. P0 – Vstup a týdenní mřížka

- [x] 2.1 Zod schéma těla a parametrů s výchozími hodnotami a varováním pro neznámé; ověřit testy neplatných hodnot
- [x] 2.2 `series.ts`: parsování, seřazení, duplicity, den v týdnu, násobky 7 dní, doplnění děr; ověřit testy vstupu ze sekce 10 zadání

## 3. P0 – Numerika a modely

- [x] 3.1 `linalg.ts`: Cholesky, Gauss s pivotací, vážená ridge; ověřit testy známé soustavy, přímky a singulární matice
- [x] 3.2 `models/naive.ts`: naive_last a naive_drift; ověřit testy predikcí
- [x] 3.3 `design.ts` trend a zlomy, `models/regression.ts` s log transformací a recency váhami; ověřit test hinge a test na přesném log-lineárním růstu
- [x] 3.4 `evaluate.ts`: metriky a rolling-origin backtest; ověřit test metrik a test „žádný únik budoucnosti“

## 4. P0 – Pipeline, API a persistence

- [x] 4.1 `pipeline.ts`: proložená historie + horizont, zaokrouhlení, ořez, diagnostika; ověřit test horizontu (154 bodů) a determinismu
- [x] 4.2 `server.ts` + `store.ts`: POST /predict, GET /prediction, chyby, persistence; ověřit testy API přes inject včetně restartu
- [x] 4.3 `scripts/backtest.ts`: tabulka kandidát × původ; ověřit spuštěním na ukázkových datech
- [x] 4.4 README quick start a curl příklady; ověřit, že příklady fungují proti běžícímu serveru

## 5. P1 – Kvalita modelu

- [x] 5.1 `calendar.ts`: Velikonoce, CZ svátky, pracovní dny, indikátory 24. 12. a 1. 1.; ověřit kalendářní testy
- [x] 5.2 Kalendářní regresory v design matrix s regularizací ke středu; ověřit test varování bez výskytu
- [x] 5.3 `robust.ts`: IRLS Huber; ověřit test odlehlého týdne
- [x] 5.4 Fourierova sezónnost s podmínkou 104 týdnů; ověřit test periodicity a varování
- [x] 5.5 Automatický výběr modelu s mřížkou, tolerancí a pojistkou baseline, sezónní původy; ověřit test, že vítěz nepodleze baseline
- [x] 5.6 `intervals.ts` a pokrytí v backtestu; ověřit testy intervalů a vypsat pokrytí ve skriptu backtest
- [x] 5.7 Osnova docs/APPROACHES.md s čísly z backtestu

## 6. P2 – Bonusy

- [x] 6.1 `monitor.ts`, predictions.jsonl, drift a `scripts/evaluate.ts`; ověřit testy monitoringu
- [x] 6.2 Graf (SVG) ze skriptu backtest; ověřit vygenerovaný soubor
- [x] 6.3 Vnořená validace výběru modelu ve skriptu backtest; ověřit výpis
- [x] 6.4 Dvoustupňová sezónnost (profil z dlouhé historie, úroveň z posledních týdnů); ověřit backtestem

## 7. Integrace

- [x] 7.1 Čistý klon: `npm install && npm start`, curl na oba endpointy, `npm test`, `npm run typecheck`, `npm run lint`, `npm run backtest` zelené; synchronizovat specifikaci s kódem

## 8. Připomínky z revize

- [x] 8.1 Golden test predikce, intervalů a skóre vítěze na ukázkových datech; ověřit, že prochází před i po úpravách
- [x] 8.2 Diagnostika proložení historie (rozklad na trend, sezónnost, kalendář); výsledek v DECISIONS.md
- [x] 8.3 `history_fit=blend` a `diagnostics.fit`; ověřit testy history.test.ts a shodný výstup `npm run backtest` před a po
- [x] 8.4 Limit `data/predictions.jsonl` na 1 000 záznamů; ověřit testem v api.test.ts
- [x] 8.5 README: příkazy pro PowerShell, curl.exe, sekce „Co se ukládá a co ne“, změřená doba POST, „Další rozvoj“; ověřit příkazy proti běžícímu serveru
- [x] 8.6 APPROACHES.md a DECISIONS.md: změřená fakta oddělená od domněnek, odchylky verzí ověřené přes npm view
