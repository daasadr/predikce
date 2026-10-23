# Spec Delta

## Purpose

Tvrdá omezení projektu hlídaná testy: povolené závislosti, deterministický výpočet bez volání LLM a absence datově specifických konstant.

## ADDED Requirements

### Requirement: Allowlist závislostí
`package.json` SHALL obsahovat jen závislosti z allowlistu (produkční `fastify`, `zod`; vývojové `typescript`, `tsx`, `vitest`, `eslint`, `prettier`, `@types/node` a odůvodněné výjimky z docs/DECISIONS.md). Test „dependency guard“ MUST selhat při jakékoli jiné závislosti.

#### Scenario: Nepovolená závislost
- **WHEN** se do `dependencies` přidá `simple-statistics`
- **THEN** test dependency guard selže

### Requirement: Determinismus
Stejný vstup a parametry SHALL dát stejný výstup (`data` i diagnostiku kromě času výpočtu a monitoringu).

#### Scenario: Opakovaný výpočet
- **WHEN** se dvakrát spustí výpočet se stejným vstupem
- **THEN** `data` jsou bitově shodná

### Requirement: Bez LLM a bez dat v kódu
Aplikace MUST NOT volat žádné LLM ani Claude API a zdrojový kód MUST NOT obsahovat data ani datově specifické konstanty (konkrétní roky, covid). Obecná kalendářní pravidla MUST být dostupná jen přes parametr `calendar`.

#### Scenario: Kontrola zdrojů
- **WHEN** test projde soubory v `src/`
- **THEN** nenajde importy SDK pro LLM, URL LLM API ani letopočty mimo definici kalendářních pravidel (např. rok zavedení svátku)
