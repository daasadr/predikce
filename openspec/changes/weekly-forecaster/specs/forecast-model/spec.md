# Spec Delta

## Purpose

Vlastní predikční jádro pro týdenní řady: regrese na transformované škále s po částech lineárním trendem, sezónností, kalendářem, váženým a robustním odhadem, intervaly predikce a naivními baseline modely.

## ADDED Requirements

### Requirement: Transformace
Model SHALL pracovat na škále `z = log1p(y)` při `transform=log` a `z = y` při `transform=none`. Predikce MUST být zpětně transformovány (`expm1` pro log), zaokrouhleny a oříznuty na ≥ 0.

#### Scenario: Zpětná transformace
- **WHEN** model na log škále předpoví `z` = ln(1001)
- **THEN** výstupní hodnota je 1000

### Requirement: Po částech lineární trend
Trend SHALL být `a + b·t + Σ δ_k·max(0, t − s_k)` s `n_changepoints` zlomy rozmístěnými rovnoměrně v prvních `changepoint_range` historie. Pro extrapolaci MUST platit sklon `b + Σ δ_k`.

#### Scenario: Hinge člen
- **WHEN** zlom leží v `s_k` = 100
- **THEN** hodnota hinge členu je 0 pro t = 90, 0 pro t = 100 a 10 pro t = 110

### Requirement: Fourierova sezónnost
Sezónnost SHALL být modelována Fourierovými členy řádu `fourier_order` (0–3) s periodou přesně jednoho roku (365,25 dne). Řád > 0 MUST být použit jen při historii aspoň 104 týdnů, jinak se vypne s varováním.

#### Scenario: Periodicita
- **WHEN** se spočítá Fourierova báze pro datum d a d + 365,25 dne
- **THEN** hodnoty báze jsou shodné (v toleranci zaokrouhlení)

#### Scenario: Krátká historie pro sezónnost
- **WHEN** je vynucen `fourier_order` = 2 a historie má 80 týdnů
- **THEN** sezónnost se nepoužije a diagnostika obsahuje varování

### Requirement: Dvoustupňová sezónnost
Při `seasonality=two_stage` (a zapnutých recency vahách) SHALL být sezónní profil odhadnut z celé historie se stejnými vahami a úroveň s trendem z deseasonalizované řady s recency vahami.

#### Scenario: Profil z celé historie
- **WHEN** řada má tři roky roční sezónnosti ±20 % na lineárním trendu a poločas je 8 týdnů
- **THEN** amplituda odhadnutého profilu na log škále je přibližně ln(1,2/0,8) a predikce se od skutečnosti liší méně než o 3 %

### Requirement: Kalendář
Při `calendar=CZ` SHALL model obsahovat regresory: logaritmus podílu pracovních dnů týdne `ln(max(wd, 0.5)/5)` (po–pá bez českých státních svátků včetně Velkého pátku a Velikonočního pondělí), indikátor týdne obsahujícího 24. 12. a indikátor týdne obsahujícího 1. 1. Pravidla MUST stát na kalendářních datech, ne na číslech ISO týdnů. Velikonoce MUST být počítány vlastním algoritmem. `calendar=none` MUST kalendářní regresory vypnout. Pokud jev v historii nenastal, MUST být jeho koeficient silně regularizován k výchozí hodnotě a MUST být vydáno varování.

#### Scenario: Velikonoční neděle
- **WHEN** se spočítají Velikonoce pro roky 2019, 2020, 2021 a 2024
- **THEN** výsledky jsou 2019-04-21, 2020-04-12, 2021-04-04 a 2024-03-31

#### Scenario: Novoroční týden podle kalendáře
- **WHEN** se vyhodnotí týdny začínající 2020-12-28 a 2021-01-04
- **THEN** první obsahuje 1. 1. a druhý ne

#### Scenario: Vánoční týden
- **WHEN** se vyhodnotí týden začínající 2020-12-21
- **THEN** obsahuje 24. 12.

### Requirement: Vážená ridge regrese s vlastním řešičem
Koeficienty SHALL být odhadnuty z normálních rovnic `(XᵀWX + Λ)β = XᵀWz` vlastním řešičem bez maticových knihoven. Λ MUST penalizovat zlomy `1/changepoint_prior_scale²` (po standardizaci t do [0, 1] a z na jednotkový rozsah), sezónní a kalendářní členy slaběji a absolutní člen a sklon nepenalizovat. Singulární soustava MUST NOT způsobit pád ani nekonečné hodnoty.

#### Scenario: Známá soustava
- **WHEN** se řeší soustava se známým řešením
- **THEN** řešič vrátí toto řešení v toleranci 1e-9

#### Scenario: Ridge na přímce
- **WHEN** se ridge regrese bez penalizace a, b fituje na body y = 2x + 1
- **THEN** koeficienty jsou přibližně (1, 2)

#### Scenario: Singulární matice
- **WHEN** se řeší singulární soustava
- **THEN** řešič vrátí konečný vektor bez výjimky

### Requirement: Váhy pozorování
Váha pozorování SHALL být součinem recency váhy `0.5^(stáří/recency_half_life_weeks)` (bez útlumu při `none`), robustní váhy z IRLS (Huber podle MAD reziduí, 3–5 iterací, při `robust=1`) a nulové váhy pro chybějící týdny. Historie MUST zůstat proložena celá.

#### Scenario: Odlehlý týden
- **WHEN** řada obsahuje jeden týden s hodnotou 10× nižší než okolí
- **THEN** robustní váha tohoto týdne je výrazně menší než 1 a predikce se od predikce bez tohoto týdne liší jen málo

#### Scenario: Chybějící týden
- **WHEN** v řadě chybí týden
- **THEN** jeho váha při fitu je 0

### Requirement: Intervaly predikce
Při zadané `interval_width` SHALL model vrátit pro predikované týdny meze z rozptylu reziduí na transformované škále, škálované s horizontem (σ·√h) a kalibrované faktorem z kvantilu standardizovaných chyb backtestu; na původní škále při log transformaci vychází interval multiplikativně. Empirické pokrytí (leave-one-origin-out) i pokrytí bez kalibrace MUST být uvedeno v diagnostice.

#### Scenario: Pokrytí v diagnostice
- **WHEN** se volá predikce s `interval_width` = 0.75 na řadě s dostatečnou historií
- **THEN** `diagnostics.intervals.coverage` obsahuje skutečné pokrytí v backtestu jako číslo mezi 0 a 1

#### Scenario: Interval se rozšiřuje
- **WHEN** se porovná šířka intervalu v 1. a 10. týdnu horizontu (log škála)
- **THEN** interval v 10. týdnu není užší

### Requirement: Naivní baseline
Systém SHALL implementovat `naive_last` (poslední pozorovaná hodnota) a `naive_drift` (poslední hodnota plus průměrná týdenní změna za posledních k pozorování).

#### Scenario: Naivní predikce
- **WHEN** řada končí hodnotami 100, 110, 120 a model je `naive_last`
- **THEN** všechny predikované hodnoty jsou 120

#### Scenario: Drift
- **WHEN** řada je 100, 110, 120 a model je `naive_drift`
- **THEN** predikce na 1. a 2. týden je 130 a 140

### Requirement: Numerická robustnost a škálová nezávislost
Pro konstantní řadu, řadu s nulami, extrémní odlehlé hodnoty a velká čísla MUST výstup neobsahovat NaN ani Infinity a výpočet MUST NOT spadnout. Vynásobení všech vstupních hodnot deseti MUST vést (s malou tolerancí) k desetkrát větším predikcím.

#### Scenario: Konstantní řada
- **WHEN** všech 60 týdnů má hodnotu 500
- **THEN** predikce jsou přibližně 500 a výstup neobsahuje NaN

#### Scenario: Škálová nezávislost
- **WHEN** se ukázková data vynásobí 10
- **THEN** každá predikce je v toleranci 2 % desetinásobkem původní predikce
