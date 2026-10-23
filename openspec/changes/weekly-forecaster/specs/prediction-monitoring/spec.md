# Spec Delta

## Purpose

Sledování skutečné přesnosti dřívějších predikcí v provozu a včasné varování před driftem, bez nových endpointů.

## ADDED Requirements

### Requirement: Záznam predikcí
Každý úspěšný výpočet SHALL být přidán jako řádek do `data/predictions.jsonl` (čas výpočtu, efektivní parametry, vybraný model, očekávané WAPE z backtestu, predikované týdny modelu i naivní baseline a otisk konce vstupní řady). Soubor MUST držet nejvýše 1 000 nejnovějších záznamů.

#### Scenario: Přidání záznamu
- **WHEN** proběhnou dva úspěšné výpočty
- **THEN** soubor `predictions.jsonl` obsahuje dva řádky platného JSON

#### Scenario: Omezená velikost logu
- **WHEN** počet záznamů překročí limit
- **THEN** soubor obsahuje jen nejnovějších 1 000 záznamů

### Requirement: Realizovaná přesnost
Při `POST /predict` SHALL systém najít nejnovější dřívější záznam téže řady (jeho poslední vstupní týden je ve vstupu se stejnou hodnotou a je dřívější než konec vstupu), jehož predikované týdny už jsou ve vstupu skutečné, a v `diagnostics.monitoring` vrátit realizované WAPE a bias modelu i naivní baseline.

#### Scenario: Doplněné skutečnosti
- **WHEN** se nejprve predikuje z prvních 134 týdnů a pak se pošle všech 144 týdnů
- **THEN** `diagnostics.monitoring` obsahuje realizované WAPE a bias za 10 porovnaných týdnů

#### Scenario: Jiná řada
- **WHEN** nový vstup neobsahuje poslední týden dřívějšího záznamu se stejnou hodnotou
- **THEN** tento záznam se pro monitoring nepoužije

### Requirement: Varování před driftem
Systém SHALL vydat varování o driftu, když realizované WAPE je horší než `drift_threshold` × očekávané WAPE z backtestu nebo horší než realizované WAPE naivní baseline.

#### Scenario: Drift
- **WHEN** skutečnosti po predikci prudce klesnou na polovinu
- **THEN** `diagnostics.monitoring.drift` je true a `diagnostics.warnings` obsahuje varování o driftu

### Requirement: Skript evaluate
`npm run evaluate [soubor.json]` SHALL vyhodnotit všechny záznamy v `data/predictions.jsonl` proti skutečnostem ze souboru a vypsat realizované WAPE a bias.

#### Scenario: Bez záznamů
- **WHEN** `predictions.jsonl` neexistuje
- **THEN** skript vypíše, že nejsou žádné záznamy, a skončí s kódem 0
