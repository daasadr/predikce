# Design

## Context

Projekt začíná od nuly (viz proposal.md – Why). Omezení: Node.js ≥ 20, TypeScript strict, ESM, allowlist závislostí (fastify, zod + vývojové nástroje), vlastní implementace numeriky, žádná data v kódu, deterministický výpočet, jen dva endpointy. Požadavky jsou ve `specs/`.

## Goals / Non-Goals

**Goals:**
- Bezstavové jádro `forecast(points, params) → { data, diagnostics }`, které API, skripty i testy volají stejně.
- Malá, čitelná numerika (řádově stovky řádků) s testy na známých příkladech.
- Výběr modelu podložený poctivým backtestem, ne laděním na ukázková data.

**Non-Goals:**
- Hierarchické a vícenásobné řady, exogenní regresory od uživatele, jiné frekvence než týdenní.
- Autentizace, databáze, fronty, horizontální škálování.
- Pravděpodobnostně přesné intervaly (jen empiricky ověřená aproximace).

## Decisions

### Architektura modulů
`src/server.ts` (fastify, mapování chyb) → `src/schemas.ts` (zod pro tělo požadavku a parametry) → `src/forecast/pipeline.ts` (validace řady, výběr modelu, finální fit, sestavení výstupu) → moduly jádra (`series`, `design`, `calendar`, `linalg`, `robust`, `models/naive`, `models/regression`, `evaluate`, `intervals`, `monitor`). `src/store.ts` drží poslední výsledek v paměti a na disku (atomický zápis přes dočasný soubor a rename) a přidává řádky do `predictions.jsonl`. Server je vytvářen továrnou `buildServer({ dataDir })`, aby testy běžely přes `fastify.inject` v dočasném adresáři.

### Časová osa a standardizace
Index týdne `t` je pozice na týdenní mřížce (0 … n−1). Do matice jde `t/T`, kde `T = n_train − 1`, takže historie leží v [0, 1] a budoucnost za 1. Cílová proměnná se škáluje `z_s = (z − min z)/(max z − min z)` (při nulovém rozsahu dělitel 1). Díky tomu má `λ = 1/changepoint_prior_scale²` stejný význam pro libovolně velkou řadu. Alternativa (škálování maximem jako Prophet) byla zamítnuta, protože na log škále dává rozsah lepší kontrolu nad sklonem.

### Zlomy trendu
Polohy `s_k = k·(H − 1)/K` pro k = 1…K, kde `H = floor(n·changepoint_range)`; K se omezí na `H − 1`, aby každý zlom měl data za sebou. Hinge `max(0, t − s_k)` je spojitý, takže není potřeba Prophetova korekce offsetu.

### Penalizace
`Λ` je diagonální: a, b → 0; zlomy → `1/cps²`; Fourier a kalendář → 0,01 (odpovídá prior scale 10 jako v Prophetu). Ke všem prvkům diagonály se přidá 1e-9 kvůli numerické stabilitě. Váhy W nejsou normalizované (nejnovější týden má recency váhu 1), takže krátký poločas zvyšuje relativní sílu penalizace – to je žádoucí, protože efektivně méně dat znamená víc regularizace.

### Kalendářní jev bez výskytu
Ridge s nenulovým apriorním středem: `(XᵀWX + Λ)β = XᵀWz + Λμ`. Když sloupec nemá v trénovacích datech (s váhou > 0) žádný nenulový prvek, penalizace se zvýší na 1e4 a střed `μ` je: pro regresor pracovních dnů na log škále 1/rozsah(z) (prodeje úměrné počtu pracovních dnů), jinak 0. Vydá se varování.

### Řešič
Cholesky; když selže (nekladný pivot), Gaussova eliminace s částečným výběrem pivota, kde téměř nulový pivot vynuluje příslušnou proměnnou místo dělení nulou. Matice jsou malé (≤ ~25×25), výkon nehraje roli.

### Robustní váhy
IRLS s Huberovou funkcí (c = 1,345) na rezidua škálovaná `1,4826 · vážený MAD` (vážený medián s recency váhami, aby staré a odlehlé týdny nenafukovaly odhad škály). 5 iterací. Huber místo Tukeye: konvexní, stabilní z prvního OLS odhadu; odlehlé body dostanou váhu ~c/|u|.

### Výběr modelu
Kandidáti viz spec model-selection. Sezónní kandidát na původu, kde trénovací historie nemá 104 týdnů, se fituje bez sezónnosti (stejně jako by se choval v provozu), takže všichni kandidáti jsou hodnoceni na stejných původech. Složitost: naivní 0 (`naive_last` < `naive_drift`), regrese `1 + 2·fourier_order + calendar`; mezi kandidáty do tolerance se vybere ten s nejmenší složitostí, při shodě nižší WAPE, pak preferovaný default (log, CZ, delší poločas). Nevalidovatelné případy (žádný platný původ) → `naive_last` s varováním. Nejnovější původ se v případě nedostatku dat posune tak, aby měl `min_train_weeks` trénovacích týdnů a zkrácené testovací okno.

### Efektivní parametry
`GET /prediction.params` vrací hodnoty skutečně použité vybraným modelem (např. zvolený poločas, řád Fourieru), takže opětovné zaslání těchto parametrů reprodukuje stejný model. Původně zadané parametry jsou v `diagnostics.requested_params`.

### Intervaly
`σ` = robustní směrodatná odchylka reziduí na transformované škále (1,4826 · vážený MAD), šířka pro krok h: `q · σ · √h`, q z inverzní normální CDF (vlastní implementace, Acklamova aproximace). Pokrytí se měří v backtestu na všech původech. Pokud se ukáže systematicky mimo cíl, kalibruje se (rozhodnutí v DECISIONS.md).

### Monitoring
Záznam v `predictions.jsonl` nese otisk konce vstupu (poslední timestamp a hodnotu). Pro monitoring se použije nejnovější záznam, jehož otisk je v novém vstupu a je starší než konec vstupu. Realizované WAPE se porovná s očekávaným (backtest) a s realizovaným WAPE naivní baseline uložené v záznamu.

### Zobrazení proložené historie
Vybraný model s recency vahami starou historii skoro nevidí a jeho proložení je tam špatné (trend pod nulou, absolutní kalendářní efekty). `src/forecast/history.ts` proto pro výstup historie míchá vybraný model s vahou 0,5^(stáří/poločas) a tentýž model bez recency vah. Predikce, intervaly, výběr a backtest zůstávají jen z vybraného modelu; ověřuje to golden test. Alternativa (multiplikativní kalendář) by měnila model, proto je jen návrhem v DECISIONS.md.

### Limit logu predikcí
`data/predictions.jsonl` se při zápisu nad 1 000 záznamů atomicky přepíše nejnovějšími záznamy.

### Závislosti nad rámec allowlistu
`typescript-eslint` (parser a pravidla TS pro ESLint) a `@eslint/js` (doporučená pravidla) – nutné pro lint TypeScriptu, nejsou to knihovny pro predikci. Zdůvodnění v DECISIONS.md, test dependency guard je má v allowlistu.

## Risks / Trade-offs

- [Výběr hyperparametrů na stejných původech, na kterých se hodnotí, je optimistický] → malá mřížka, preference jednodušších modelů, zdokumentováno; volitelně vnořená validace (P2).
- [Jen dvě léta v ukázkových datech] → sezónnost se nepředpokládá, musí obstát v backtestu.
- [log1p není přesně škálově invariantní pro malá čísla] → tolerance v testu; pro řady s průměrem v jednotkách kusů je rozdíl patrný a je zdokumentován.
- [Intervaly z √h jsou heuristika] → měřené pokrytí v diagnostice.
- [Monitoring nemá identitu řady] → otisk konce řady; jiná řada se nesplete, pokud se náhodou neshoduje poslední týden i hodnota.

## Migration Plan

Nový projekt, migrace není potřeba. Spuštění: `npm install && npm start`.
