# Spec Delta

## Purpose

Poctivé vyhodnocení a automatický výběr modelu: metriky přesnosti, rolling-origin backtest bez úniku budoucnosti, malá mřížka kandidátů, pravidlo výběru s preferencí jednodušších modelů a skript `npm run backtest`.

## ADDED Requirements

### Requirement: Metriky
Systém SHALL počítat WAPE (`Σ|f − y| / Σ|y|` v %), MAE a bias (`Σ(f − y) / Σ y` v %). Chybějící skutečnosti MUST být z výpočtu vynechány.

#### Scenario: Známý příklad
- **WHEN** skutečnost je [100, 200] a predikce [90, 230]
- **THEN** MAE je 20, WAPE 13,33 % a bias 6,67 %

### Requirement: Rolling-origin backtest
Backtest SHALL pro každý původ fitovat model jen na data před původem a hodnotit ho na následujících `horizon_weeks` týdnech. Původy MUST zahrnovat nejnovější (posledních `horizon_weeks` týdnů), až `backtest_origins` dalších po `backtest_step` týdnech zpět a sezónně odpovídající původy (konec vstupu minus 52 a minus 104 týdnů). Původ MUST být použit jen s aspoň `min_train_weeks` týdny dat před sebou. Sezónní kandidát MUST být na původu s kratší historií než 104 týdnů fitován bez sezónnosti, aby všichni kandidáti byli hodnoceni na stejných původech. Skóre kandidáta MUST být průměr přes původy a skóre po původech MUST být dostupné v diagnostice.

#### Scenario: Žádný únik budoucnosti
- **WHEN** se změní hodnoty po původu
- **THEN** predikce z tohoto původu se nezmění

#### Scenario: Sezónní původy na ukázkových datech
- **WHEN** backtest běží na 144 týdnech ukázkových dat
- **THEN** mezi původy jsou týdny 2020-06-29 a 2019-07-01 (konec vstupu minus 52 a minus 104 týdnů)

### Requirement: Mřížka kandidátů
Při `model=auto` SHALL kandidáti zahrnovat `naive_last`, `naive_drift` a regresní modely přes `recency_half_life_weeks` ∈ {13, 26, 52, none} × `fourier_order` ∈ {0, 1, 2} × `calendar` ∈ {CZ, none} × `transform` ∈ {log, none} a pro sezónní kandidáty s recency vahami navíc `seasonality` ∈ {local, two_stage}. Explicitně zadaný parametr MUST danou dimenzi mřížky zafixovat. Sezónní kandidáti MUST být zařazeni jen při historii aspoň 104 týdnů.

#### Scenario: Fixovaný parametr
- **WHEN** params obsahují `calendar` = none
- **THEN** žádný regresní kandidát nepoužívá kalendář

#### Scenario: Krátká historie bez sezónních kandidátů
- **WHEN** řada má 80 týdnů
- **THEN** mezi kandidáty není žádný s `fourier_order` > 0

### Requirement: Pravidlo výběru
Vybrán SHALL být kandidát s nejnižším průměrným WAPE; je-li jednodušší kandidát do `selection_tolerance` (relativně) od nejlepšího, MUST být vybrán jednodušší. Pokud nejlepší regresní model nepřekoná nejlepší naivní baseline, MUST být vrácena baseline s varováním. `model` = naive, trend nebo seasonal MUST výběr omezit na danou rodinu.

#### Scenario: Vítěz nepodleze baseline
- **WHEN** běží automatický výběr na ukázkových datech
- **THEN** průměrné WAPE vybraného modelu není horší než průměrné WAPE nejlepší naivní baseline

#### Scenario: Tolerance preferuje jednodušší model
- **WHEN** nejlepší kandidát má WAPE 11,48 % a jednodušší kandidát 11,70 % při `selection_tolerance` = 0,03
- **THEN** je vybrán jednodušší kandidát a důvod výběru to uvádí

#### Scenario: Vynucený model
- **WHEN** params obsahují `model` = trend
- **THEN** vybraný model je regresní bez sezónnosti

### Requirement: Diagnostika výběru
`diagnostics` SHALL obsahovat vybraný model a jeho konfiguraci, výsledky backtestu (WAPE, MAE, bias průměrně i po původech) všech kandidátů včetně naivní baseline a seznam varování.

#### Scenario: Diagnostika po výpočtu
- **WHEN** proběhne `POST /predict` na ukázkových datech
- **THEN** `diagnostics.model`, `diagnostics.backtest.candidates` a `diagnostics.backtest.baseline` jsou vyplněné

### Requirement: Skript backtest
`npm run backtest [soubor.json]` SHALL vypsat tabulku kandidát × původ × WAPE/MAE/bias, vítěze a pokrytí intervalů. Bez argumentu MUST použít `data/weekly-sales.json`.

#### Scenario: Spuštění na ukázkových datech
- **WHEN** se spustí `npm run backtest`
- **THEN** výstup obsahuje tabulku, řádek s vítězem a pokrytí intervalů a skript skončí s kódem 0

### Requirement: Vnořená validace
Skript backtest SHALL vypsat i vnořenou validaci: pro každý původ se celý výběr modelu zopakuje jen na datech před ním a skóruje se jen model, který vybere.

#### Scenario: Poctivý odhad
- **WHEN** se spustí `npm run backtest` na ukázkových datech
- **THEN** výstup obsahuje průměrné WAPE vnořené validace a vybraný model pro každý původ
