# Spec Delta

## Purpose

Pravidla pro přijetí vstupní týdenní řady a parametrů: validace, seřazení, týdenní mřížka s chybějícími týdny a limity délky řady.

## ADDED Requirements

### Requirement: Validace timestampů
Timestampy SHALL být parsovány jako ISO 8601 v UTC. Všechny MUST padat na stejný den v týdnu a rozestupy mezi nimi MUST být násobky 7 dní, jinak 400. Duplicitní timestamp MUST vrátit 400.

#### Scenario: Špatný den v týdnu
- **WHEN** jeden z timestampů padá na úterý, ostatní na pondělí
- **THEN** odpověď je 400 s `error` = `invalid_input` a `details` jmenují problematický bod

#### Scenario: Duplicitní týden
- **WHEN** vstup obsahuje dvakrát timestamp 2020-01-06
- **THEN** odpověď je 400

#### Scenario: Neplatný timestamp
- **WHEN** timestamp není platné ISO 8601 datum
- **THEN** odpověď je 400

### Requirement: Validace hodnot
Hodnota SHALL být konečné číslo ≥ 0 a nejvýše `Number.MAX_SAFE_INTEGER`, jinak 400. Nuly MUST být přijaty jako legální pozorování.

#### Scenario: Záporná hodnota
- **WHEN** některý bod má `value` = -5
- **THEN** odpověď je 400

#### Scenario: Nuly jsou legální
- **WHEN** řada obsahuje týdny s hodnotou 0
- **THEN** výpočet proběhne a vrátí 200

### Requirement: Prázdný a krátký vstup
Prázdné nebo chybějící `data` SHALL vrátit 400. Řada s méně než 3 týdny MUST vrátit 422. Řada s 3 až `min_train_weeks` týdny MUST použít jen naivní modely a vrátit varování.

#### Scenario: Prázdný vstup
- **WHEN** `data` je prázdné pole
- **THEN** odpověď je 400

#### Scenario: Dva body
- **WHEN** `data` obsahuje 2 týdny
- **THEN** odpověď je 422

#### Scenario: Krátká historie
- **WHEN** řada má 10 týdnů a `min_train_weeks` = 26
- **THEN** odpověď je 200, vybraný model je naivní a diagnostika obsahuje varování o krátké historii

### Requirement: Seřazení a týdenní mřížka
Neseřazená data SHALL být seřazena. Chybějící týdny mezi prvním a posledním timestampem MUST být doplněny jako chybějící pozorování (váha 0 při fitu, ne nula prodejů) a MUST být uvedeny ve varování.

#### Scenario: Neseřazený vstup
- **WHEN** body přijdou v náhodném pořadí
- **THEN** výsledek je shodný s výsledkem pro seřazený vstup

#### Scenario: Díra v řadě
- **WHEN** v jinak souvislé řadě chybí jeden týden
- **THEN** výpočet proběhne, chybějící týden se nepovažuje za nulu (fit je stejný jako bez daného řádku), výstup obsahuje proložené hodnoty jen pro vstupní týdny a diagnostika obsahuje varování o doplněných týdnech

### Requirement: Parametry
`params` SHALL být volitelné pole `{name, value}` s číselnou nebo textovou hodnotou. Neznámé názvy MUST být ignorovány s varováním v diagnostice. Neplatná hodnota známého parametru MUST vrátit 400. Podporované parametry a výchozí hodnoty: `horizon_weeks` (10), `interval_width` (bez výchozí, 0 ≤ w < 1), `model` (auto | naive | trend | seasonal; auto), `transform` (log | none; log), `changepoint_prior_scale` (0.5), `changepoint_range` (0.8), `n_changepoints` (10), `recency_half_life_weeks` (auto | none | číslo > 0; auto), `fourier_order` (auto | 0–3; auto), `calendar` (CZ | none; CZ), `seasonality` (auto | local | two_stage; auto), `history_fit` (blend | model; blend), `robust` (0 | 1; 1), `backtest_origins` (4), `backtest_step` (13), `min_train_weeks` (26), `selection_tolerance` (0.03), `drift_threshold` (2).

#### Scenario: Neznámý parametr
- **WHEN** params obsahují `{ "name": "foo", "value": 1 }`
- **THEN** výpočet proběhne a `diagnostics.warnings` obsahuje varování o neznámém parametru `foo`

#### Scenario: Neplatná hodnota parametru
- **WHEN** params obsahují `interval_width` = 1.5
- **THEN** odpověď je 400 a `details` jmenují parametr `interval_width`

#### Scenario: Číselná hodnota jako text
- **WHEN** params obsahují `horizon_weeks` = "12"
- **THEN** použije se horizont 12 týdnů
