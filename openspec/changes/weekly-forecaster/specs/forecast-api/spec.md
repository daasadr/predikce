# Spec Delta

## Purpose

HTTP rozhraní prediktoru: blokující výpočet predikce přes `POST /predict` a čtení posledního výpočtu přes `GET /prediction`, včetně formátu chyb a persistence přes restart.

## ADDED Requirements

### Requirement: Pouze dva endpointy
Aplikace SHALL vystavovat právě dva endpointy: `POST /predict` a `GET /prediction`. Jakákoli jiná cesta nebo metoda MUST vrátit 404 s JSON chybou.

#### Scenario: Neznámá cesta
- **WHEN** klient zavolá `GET /health`
- **THEN** server odpoví 404 a tělem `{ "error": "not_found", "message": ... }`

### Requirement: Blokující výpočet predikce
`POST /predict` SHALL přijmout `{ "params"?: [{name, value}], "data": [{timestamp, value}] }`, provést výpočet synchronně a vrátit výsledek v téže odpovědi se stavem 200 (žádná fronta, žádné 202).

#### Scenario: Úspěšná predikce na ukázkových datech
- **WHEN** klient pošle 144 týdnů ukázkových dat bez params
- **THEN** odpověď je 200 s `data` o 154 bodech: 144 proložených hodnot pro vstupní týdny a za nimi 10 predikovaných týdnů od 2021-06-28 do 2021-08-30

### Requirement: Formát výstupních bodů
Každý bod výstupu SHALL mít `timestamp` ve tvaru `YYYY-MM-DDTHH:mm:ss.sssZ` a `value` jako celé číslo ≥ 0. Body MUST být seřazené vzestupně podle času. Výstup MUST obsahovat proloženou hodnotu pro každý týden přítomný ve vstupu a za nimi `horizon_weeks` predikovaných týdnů.

#### Scenario: Celé nezáporné hodnoty
- **WHEN** predikce proběhne pro libovolnou platnou řadu
- **THEN** každá `value` ve výstupu je konečné celé číslo ≥ 0 a timestampy jsou rostoucí

#### Scenario: Intervaly jen na vyžádání
- **WHEN** params obsahují `interval_width` = 0.75
- **THEN** každý predikovaný bod má navíc `lower` a `upper` (celá čísla, `lower ≤ value ≤ upper`), proložené body je nemají
- **WHEN** params `interval_width` neobsahují
- **THEN** žádný bod nemá `lower` ani `upper`

### Requirement: Proložení historie
Při `history_fit=blend` (výchozí) a vítězném regresním modelu s recency vahami SHALL být proložené hodnoty historie směsí hlavního modelu a téhož modelu bez recency vah, s váhou hlavního modelu rovnou jeho recency váze daného týdne. Predikce a intervaly MUST zůstat jen z hlavního modelu. `history_fit=model` MUST vracet proložení hlavního modelu. `diagnostics.fit` MUST obsahovat in-sample WAPE proložení hlavního modelu i vráceného výstupu.

#### Scenario: Predikce se nemění
- **WHEN** se ukázková data spočítají s `history_fit=blend` a s `history_fit=model`
- **THEN** predikované hodnoty a intervaly jsou shodné a liší se jen proložená historie

#### Scenario: Plynulý přechod
- **WHEN** se vrátí proložená historie s `history_fit=blend`
- **THEN** poslední vstupní týden má stejnou proloženou hodnotu jako s `history_fit=model`

### Requirement: Horizont z posledního timestampu
Predikované týdny SHALL navazovat na poslední timestamp vstupu s krokem 7 dní a MUST NOT záviset na aktuálním datu.

#### Scenario: Horizont pro ukázková data
- **WHEN** poslední vstupní týden je 2021-06-21 a `horizon_weeks` = 10
- **THEN** první predikovaný týden je 2021-06-28 a poslední 2021-08-30

### Requirement: Poslední výpočet přes GET /prediction
`GET /prediction` SHALL vrátit `{ data, params, calculated_at, diagnostics }` posledního úspěšného výpočtu, kde `params` jsou efektivní parametry včetně výchozích hodnot a `calculated_at` je ISO čas výpočtu. Před prvním výpočtem MUST vrátit 404 s JSON chybou.

#### Scenario: GET před prvním POST
- **WHEN** server ještě neprovedl žádný výpočet a neexistuje uložený stav
- **THEN** `GET /prediction` vrátí 404 a `{ "error": "not_found", ... }`

#### Scenario: GET po POST
- **WHEN** klient úspěšně zavolá `POST /predict` a pak `GET /prediction`
- **THEN** `data` jsou shodná s odpovědí POST, `params` obsahují všechny parametry s efektivními hodnotami a `calculated_at` je platný ISO timestamp

### Requirement: Persistence přes restart
Poslední výpočet SHALL být uložen do `data/last-prediction.json` (adresář lze změnit proměnnou prostředí `DATA_DIR`) a po restartu serveru MUST být dostupný přes `GET /prediction`.

#### Scenario: Restart serveru
- **WHEN** proběhne `POST /predict`, server se zastaví a znovu spustí nad stejným datovým adresářem
- **THEN** `GET /prediction` vrátí stejný výsledek jako před restartem

### Requirement: Jednotný formát chyb
Chyby SHALL mít tvar `{ "error": "<kód>", "message": "...", "details": [...] }`. Neplatný vstup MUST vrátit 400, příliš krátká nebo nepoužitelná řada 422 a 500 MUST být použito jen pro neočekávané chyby.

#### Scenario: Nevalidní JSON
- **WHEN** tělo požadavku není platný JSON
- **THEN** odpověď je 400 s `error` = `invalid_input`

#### Scenario: Krátká řada
- **WHEN** vstup obsahuje méně než 3 týdny
- **THEN** odpověď je 422 s `error` = `series_too_short`

### Requirement: Port z prostředí
Server SHALL naslouchat na portu z proměnné `PORT`, výchozí 3000, a MUST jít spustit příkazem `npm start` po `npm install` na čistém klonu.

#### Scenario: Výchozí port
- **WHEN** `PORT` není nastaven a spustí se `npm start`
- **THEN** server odpovídá na `http://localhost:3000`
