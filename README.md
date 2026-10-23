# Týdenní prediktor prodejů (FreshPoint)

Univerzální prediktor pro libovolnou týdenní řadu prodejů v kusech: z minulých týdnů předpoví `horizon_weeks` (výchozí 10) týdnů dopředu a vrátí i proložení historie. Běží lokálně jako REST API v Node.js. Predikční jádro = regrese, řešič soustav, robustní váhy, kalendář, backtest.

- Diskuze přístupů: [docs/APPROACHES.md](docs/APPROACHES.md)
- Rozhodnutí a jejich důvody: [docs/DECISIONS.md](docs/DECISIONS.md)
- Specifikace (OpenSpec): [openspec/changes/weekly-forecaster/](openspec/changes/weekly-forecaster/)

## Rychlý start

Potřebujete Node.js ≥ 20.19 (LTS). Příkazy `npm` jsou stejné v bashi (Linux, macOS) i v PowerShellu (Windows).

```bash
npm install
npm start            # build + server na http://localhost:3000
```

Jiný port nebo datový adresář:

```bash
PORT=4000 DATA_DIR=/tmp/forecaster npm start
```

```powershell
$env:PORT = 4000; $env:DATA_DIR = "C:\temp\forecaster"; npm start
```

Další příkazy:

| Příkaz | Co dělá |
|---|---|
| `npm run dev` | server s automatickým restartem (tsx watch) |
| `npm test` | testy (vitest) |
| `npm run typecheck` / `npm run lint` | kontrola typů / ESLint + Prettier |
| `npm run backtest [soubor.json] [--full]` | tabulka kandidát × původ × WAPE/MAE/bias, vítěz, pokrytí intervalů, vnořená validace a graf `out/forecast.svg` |
| `npm run evaluate [soubor.json]` | realizovaná přesnost uložených predikcí (`data/predictions.jsonl`) proti skutečnostem |

Vstupní soubor skriptů je pole bodů nebo tělo `POST /predict`; bez argumentu se použije `data/weekly-sales.json`. Ve Windows lze cestu psát s `/` i s `\` (např. `npm run backtest data\example-request.json`).

> **Windows:** v PowerShellu je `curl` alias na `Invoke-WebRequest` a s parametry z příkladů níže nefunguje. Použijte `Invoke-RestMethod` (příklady jsou uvedené) nebo skutečný curl jako `curl.exe`.

## API

### `POST /predict`

Blokující výpočet: model se naučí z dat ve vstupu a výsledek přijde v téže odpovědi. Tělo: `{ "params": [{ "name": "...", "value": ... }], "data": [{ "timestamp": "ISO 8601", "value": 123 }] }`, `params` je volitelné.

Ukázková data (144 týdnů, s intervalem 0,75):

```bash
curl -X POST http://localhost:3000/predict \
  -H "Content-Type: application/json" \
  --data-binary @data/example-request.json
```

```powershell
$r = Invoke-RestMethod -Method Post -Uri http://localhost:3000/predict -ContentType "application/json" -InFile data\example-request.json
$r.data.Count
$r.data[-1]
```

Malý příklad (3 týdny, horizont 2), tělo je v souboru, aby nevadily rozdílné uvozovky v bashi a PowerShellu:

```bash
curl -X POST http://localhost:3000/predict -H "Content-Type: application/json" --data-binary @data/example-small.json
```

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/predict -ContentType "application/json" -InFile data\example-small.json | ConvertTo-Json -Depth 8
```

Ve Windows funguje i `curl.exe` se stejnými parametry jako v bashi (napsané na jeden řádek).

Odpověď 200 obsahuje proložené hodnoty pro každý vstupní týden a za nimi predikované týdny (celé kusy ≥ 0, seřazeno). S `interval_width` mají predikované body navíc `lower` a `upper`:

```json
{
  "data": [
    { "timestamp": "2018-09-24T00:00:00.000Z", "value": 0 },
    "… 142 dalších proložených týdnů …",
    { "timestamp": "2021-06-21T00:00:00.000Z", "value": 15823 },
    { "timestamp": "2021-06-28T00:00:00.000Z", "value": 16099, "lower": 15495, "upper": 16704 },
    "…",
    { "timestamp": "2021-08-30T00:00:00.000Z", "value": 18161, "lower": 16249, "upper": 20072 }
  ]
}
```

Pro ukázková data je v odpovědi 154 bodů a poslední je týden 2021-08-30. Horizont se počítá od posledního timestampu vstupu (krok 7 dní), ne od dnešního data.

### `GET /prediction`

Vrátí poslední výpočet včetně efektivních parametrů, času výpočtu a diagnostiky. Stav je v paměti a v `data/last-prediction.json`, takže přežije restart. Před prvním výpočtem vrací 404.

```bash
curl http://localhost:3000/prediction
```

```powershell
Invoke-RestMethod http://localhost:3000/prediction | ConvertTo-Json -Depth 8
```

```json
{
  "data": ["… stejné jako odpověď POST …"],
  "params": [{ "name": "horizon_weeks", "value": 10 }, { "name": "model", "value": "seasonal" }, "…"],
  "calculated_at": "2026-10-23T19:45:21.046Z",
  "diagnostics": {
    "model": { "id": "regression(transform=none, half_life=13, fourier=1, calendar=CZ)", "family": "seasonal", "selection_reason": "…", "config": {}, "details": {} },
    "backtest": { "origins": [], "selected": {}, "baseline": {}, "candidates": [] },
    "intervals": { "width": 0.75, "coverage": 0.743, "coverage_uncalibrated": 0.914, "calibration_factor": 0.6146 },
    "series": { "input_weeks": 144, "missing_weeks": 0, "forecast_from": "2021-06-28T00:00:00.000Z" },
    "fit": { "history_fit": "blend", "in_sample_wape_model": 15.05, "in_sample_wape_output": 11.95 },
    "warnings": [],
    "requested_params": [],
    "monitoring": { "status": "no_previous_prediction", "drift": false, "drift_reasons": [] }
  }
}
```

`params` obsahuje skutečně použité hodnoty (např. vybraný poločas a řád Fourieru). Když je pošlete zpět se stejnými daty, dostanete stejný model.

### Chyby

`{ "error": "kód", "message": "...", "details": [...] }`

| Stav | `error` | Kdy |
|---|---|---|
| 400 | `invalid_input` | neplatný JSON nebo tvar těla, prázdná data, špatný timestamp, jiný den v týdnu, rozestup není násobek 7 dní, duplicitní týden, záporná nebo nekonečná hodnota, neplatná hodnota parametru |
| 404 | `not_found` | `GET /prediction` před prvním výpočtem, neexistující cesta |
| 422 | `series_too_short` | méně než 3 týdny |
| 500 | `internal_error` | jen neočekávaná chyba |

`Invoke-RestMethod` při stavu 4xx vyhodí výjimku a tělo chyby je v `$_.ErrorDetails.Message` (ověřeno ve Windows PowerShellu 5.1):

```powershell
try { Invoke-RestMethod http://localhost:3000/prediction } catch { $_.ErrorDetails.Message }
```

## Parametry

Všechny parametry jsou volitelné. U dimenzí označených „auto“ vybírá hodnotu backtest. Neznámé názvy se ignorují s varováním v `diagnostics.warnings`.

| Název | Hodnoty | Výchozí | Význam |
|---|---|---|---|
| `horizon_weeks` | celé 1–520 | 10 | počet predikovaných týdnů |
| `interval_width` | 0 ≤ w < 1 | – | šířka intervalu predikce; bez ní se intervaly nevracejí |
| `model` | auto, naive, trend, seasonal | auto | rodina modelu; auto vybírá včetně naivních |
| `transform` | log, none | auto | škála regrese: `log1p` nebo identita; log se použije bez backtestu (příliš krátká řada), jinak rozhoduje backtest (na ukázkových datech vyhrála none) |
| `changepoint_prior_scale` | > 0 | 0,5 | volnost zlomů trendu (λ = 1/scale²) |
| `changepoint_range` | (0, 1] | 0,8 | podíl historie, kde mohou být zlomy |
| `n_changepoints` | celé 0–100 | 10 | počet zlomů |
| `recency_half_life_weeks` | auto, none, číslo > 0 | auto (13/26/52/none) | poločas vah: novější týdny mají větší váhu |
| `fourier_order` | auto, 0–3 | auto (0/1/2) | řád roční sezónnosti; > 0 jen při historii ≥ 104 týdnů |
| `calendar` | CZ, none | auto | české svátky, pracovní dny, týdny s 24. 12. a 1. 1.; CZ se použije bez backtestu, jinak rozhoduje backtest |
| `seasonality` | auto, local, two_stage | auto | sezónní profil spolu s trendem, nebo z celé historie (dvoustupňově) |
| `history_fit` | blend, model | blend | jak se zobrazí proložená historie (viz níže); predikci nemění |
| `robust` | 0, 1 | 1 | robustní váhy (Huber), tlumí odlehlé týdny |
| `backtest_origins` | celé 0–50 | 4 | počet dalších původů backtestu |
| `backtest_step` | celé ≥ 1 | 13 | rozestup původů v týdnech |
| `min_train_weeks` | celé ≥ 4 | 26 | minimum historie pro původ; kratší řada → jen naivní modely |
| `selection_tolerance` | 0–1 | 0,03 | jednodušší model vyhraje, je-li do 3 % (relativně) od nejlepšího |
| `drift_threshold` | > 0 | 2 | drift, když realizované WAPE > threshold × očekávané |

## Jak to funguje

1. **Vstup:** validace, seřazení a týdenní mřížka. Chybějící týden je chybějící pozorování (váha 0), ne nula.
2. **Model:** vážená ridge regrese na škále `log1p` nebo identity. Obsahuje po částech lineární trend se zlomy, volitelnou Fourierovu roční sezónnost a kalendář CZ. Recency váhy tlumí staré týdny a robustní váhy (IRLS, Huber) odlehlé týdny. Soustavu řeší vlastní Cholesky nebo Gauss.
3. **Výběr:** rolling-origin backtest na posledních 10 týdnech, na 4 dalších původech po 13 týdnech a na sezónních původech (−52 a −104 týdnů). Kandidáti jsou `naive_last`, `naive_drift` a 72 regresí. Vyhraje nejnižší průměrné WAPE, jednodušší model do 3 % má přednost a vítěz nikdy nepodleze naivní baseline.
4. **Intervaly:** σ·√h z reziduí, kalibrované kvantilem chyb backtestu. Pokrytí se měří leave-one-origin-out.
5. **Proložená historie (`history_fit=blend`):** vybraný model s recency vahami předpovídá dobře, ale staré týdny skoro nevidí a jejich proložení je špatné (trend se zpětně dostane pod nulu). Pro zobrazení historie se proto spočítá ještě tentýž model bez recency vah. Týden t dostane váhu 0,5^(stáří/poločas) z vybraného modelu a zbytek z modelu bez vah. Poslední týden je tak přesně z vybraného modelu a na styku s predikcí nevznikne skok. **Výstup historie je směs dvou křivek, ne jeden model.** Predikce a intervaly jsou vždy jen z vybraného modelu. `history_fit=model` vrátí čisté proložení vybraného modelu a `diagnostics.fit` uvádí in-sample WAPE obou variant.
6. **Monitoring:** každý výpočet se přidá do `data/predictions.jsonl`. Při dalším volání se dřívější predikce téže řady porovná s doplněnými skutečnostmi (`diagnostics.monitoring`) a při driftu přibude varování.

## Co se ukládá a co ne

Služba se z dřívějších běhů neučí. Každé volání trénuje znovu z dat v požadavku, takže nejsou žádné uložené váhy, které by mohly zastarat. Uložené predikce slouží jen ke kontrole přesnosti (monitoring).

| Soubor | Obsah | Velikost |
|---|---|---|
| `data/last-prediction.json` | poslední výpočet pro `GET /prediction` (data, parametry, čas, diagnostika) | přepisuje se, vždy jeden výpočet |
| `data/predictions.jsonl` | jeden řádek na výpočet: čas, parametry, model, očekávané WAPE, predikované týdny modelu i naivní baseline, otisk konce řady | nejvýše 1 000 nejnovějších záznamů, starší se při zápisu zahodí |

Vstupní data se neukládají, jen otisk posledního týdne (timestamp a hodnota), podle kterého monitoring pozná, že jde o stejnou řadu. Adresář lze změnit proměnnou `DATA_DIR`, oba soubory jsou v `.gitignore`.

## Výsledky backtestu na ukázkových datech

`npm run backtest` na `data/weekly-sales.json` (144 týdnů, 2018-09-24 až 2021-06-21):

| Model | Průměrné WAPE | MAE | Bias |
|---|---|---|---|
| **Vítěz:** regrese `transform=none, half_life=13, fourier=1, calendar=CZ` | **11,70 %** | 1 174 | −6,39 % |
| Nejlepší surové WAPE: totéž s `fourier=2, seasonality=two_stage` (nevybráno, složitější a do 3 %) | 11,48 % | 1 151 | −5,89 % |
| Nejlepší log model: `transform=log, half_life=13, fourier=1, calendar=CZ` | 14,82 % | 1 261 | +6,45 % |
| `naive_last` (nejlepší baseline) | 16,16 % | 1 542 | −7,54 % |
| `naive_drift` | 24,64 % | 2 202 | +2,00 % |
| Vnořená validace celého výběru (poctivý odhad) | 15,31 % | – | −2,76 % |

Vítěz po původech (WAPE / bias):

| První testovaný týden | Typ | WAPE | Bias |
|---|---|---|---|
| 2021-04-19 | nejnovější | 4,59 % | −2,71 % |
| 2021-01-18 | rolling | 8,03 % | −6,38 % |
| 2020-10-19 | rolling | 11,67 % | +10,73 % |
| 2020-07-20 | rolling | 14,48 % | −14,48 % |
| 2020-06-29 | sezónní (−52) | 19,86 % | −19,86 % |
| 2020-04-20 | rolling | 14,79 % | −12,69 % |
| 2019-07-01 | sezónní (−104) | 8,51 % | +0,69 % |

Intervaly (šířka 0,75): kalibrované pokrytí **74,3 %** (leave-one-origin-out, 70 týdnů), bez kalibrace 91,4 %.

Predikce 2021-06-28 až 2021-08-30: 16 099, **11 615**, 16 636, 16 893, 17 140, 17 374, 17 594, 17 800, 17 989, 18 161 ks. Propad v týdnu od 5. 7. 2021 způsobují svátky 5. a 6. 7. (3 pracovní dny). Model se ho naučil z ostatních svátkových týdnů, např. z týdne s Velkým pátkem 2021 (8 835 ks proti zhruba 13 000).

Proložená historie: in-sample WAPE 11,95 % s `history_fit=blend` (15,05 % s `history_fit=model`).

![Graf](out/forecast.svg)

(graf vznikne po `npm run backtest`)

## Omezení

- **Výběr hyperparametrů na stejných původech je optimistický.** Vítěz má 11,70 %, ale vnořená validace dává 15,31 %, což je jen o něco lepší než `naive_last` (16,16 %). Vnořená validace běží jen ve skriptu backtest.
- **Sezónnost je slabě podložená.** V datech jsou dvě léta, z toho jedno covidové. Sezónní kandidát se na původech s historií pod 104 týdnů fituje bez sezónnosti, takže důkaz pro `fourier=1` pochází jen ze tří nejnovějších původů. S poločasem 13 týdnů se Fourierův člen chová spíš jako zakřivení trendu než jako roční profil.
- **Model systematicky podstřeluje** (bias −6,39 %). Domněnka, neověřená: firma rostla rychleji, než trend z posledních týdnů extrapoluje. U čerstvého zboží podstřelení znamená spíš výpadky než odpisy.
- **Log škála** je teoreticky vhodná, ale na těchto datech přestřelovala (bias log kandidátů +3,6 až +27 %). Výběr ji proto nezvolil. Příčina není ověřená (viz DECISIONS.md).
- **Proložená historie je směs dvou křivek** (viz Jak to funguje, bod 5) a ani tak není u starých týdnů přesná. Kalendářní efekt je při `transform=none` absolutní v kusech, naučený z nedávné úrovně, takže při nízké úrovni v roce 2018 srazí svátkový týden k nule. Týdny 2018-09-24 (svátek 28. 9.) a 2018-12-31 (Nový rok) proto mají proloženou hodnotu 0. Vánoce 2020 naopak vycházejí výš než skutečnost (6 997 proti 4 667). Na predikci to nemá vliv.
- **Doba výpočtu a blokování.** Jeden `POST /predict` s ukázkovými daty trvá 0,52–0,82 s (8 měření na vývojovém počítači; `Measure-Command { Invoke-RestMethod … }` a Node `fetch`). V testech API je to kvůli souběhu testů 1–2 s. Server je jednovláknový a výpočet blokuje: `GET /prediction` poslaný 100 ms po POST čekal 0,42–0,65 s, než POST doběhl. Pro více klientů nebo delší řady by výpočet patřil do worker threadu.
- **Intervaly** jsou heuristika σ·√h s kalibrací na ~70 týdnech backtestu, ne přesné pravděpodobnostní intervaly.
- **Monitoring** rozpoznává řadu podle posledního týdne a hodnoty, API nemá identifikátor řady.
- Jedna agregovaná řada. Hierarchie automatů a produktů ani exogenní proměnné (počasí, akce) nejsou v rozsahu.

## Další rozvoj

- **Jiné výstupní termíny.** V provozu dává smysl vracet jen týdny, o kterých se rozhoduje. Typický důvod je dodací lhůta: když se zboží objednává tři týdny předem, nezajímá nás predikce na příští týden, ale na týdny 3 až 10. Model by přitom musel počítat i přes „přeskočený“ úsek, protože z konce dat se extrapoluje souvisle, a ořízl by se jen výstup. Stačil by parametr typu `forecast_from` (nebo posun v týdnech) vedle `horizon_weeks`.
- **Multiplikativní kalendářní efekty** i při `transform=none` (efekt svátku jako podíl úrovně, ne pevný počet kusů), viz DECISIONS.md. Zlepšilo by to proložení historie při nízké úrovni a možná i predikci.
- **Výpočet mimo hlavní vlákno** (worker thread), aby server během výpočtu odpovídal.
