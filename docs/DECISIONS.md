# Rozhodnutí

Každé netriviální rozhodnutí v 1–3 větách. Čísla z backtestu odpovídají `npm run backtest` na `data/weekly-sales.json`.

## Rozsah a architektura

1. **Univerzální prediktor místo řešení na míru.** Ukázková data slouží jen jako testovací vzorek a inspirace; v kódu nejsou žádná data ani konstanty typu „covid 2020“ (hlídá test `source guard`). Vše specifické pro jednu řadu (zlomy, poločas, sezónnost) se odhaduje nebo vybírá z dat při každém volání.
2. **Bezstavové jádro, stavová jen vrstva API.** `runForecast(points, params)` je čistá funkce, kterou volá server, skripty i testy stejně; server k ní přidává jen persistenci a monitoring. Díky tomu nezastarávají žádné uložené váhy a determinismus jde snadno testovat.
3. **Fastify místo Express.** Má vestavěný `inject` (testy API bez otevírání portu), rozumné chyby parsování JSON a limit velikosti těla. Zod kontroluje jen tvar těla; parametry parsuje vlastní tabulka, aby chybová hláška jmenovala konkrétní parametr.
4. **Pouze dva endpointy.** Monitoring a diagnostika jdou přes `GET /prediction` a skripty, žádné další cesty (neznámá cesta vrací 404 JSON).

## Nástroje a závislosti

5. **TypeScript 6.0, ne 7.** `typescript-eslint` 8.72.0 má v peer závislostech `typescript: >=4.8.4 <6.1.0`, nejnovější TypeScript je 7.0.2; TS 7 by tedy lint nepodporoval. Ověřeno `npm view typescript-eslint@8.72.0 peerDependencies` (24. 10. 2026).
6. **Vitest 4, ne 5.** Vitest 5.0.5 má `engines.node` `^22.12.0 || ^24.0.0 || >=26.0.0`, Vitest 4.1.12 `^20.0.0 || ^22.0.0 || >=24.0.0` a zadání chce Node ≥ 20. `engines` projektu je `>=20.19`, protože ESLint 10.13 vyžaduje `^20.19.0 || ^22.13.0 || >=24`. Ověřeno `npm view <balíček>@<verze> engines` (24. 10. 2026).
7. **Výjimky z allowlistu: `typescript-eslint` a `@eslint/js`.** Jsou nutné, aby ESLint uměl TypeScript a měl doporučená pravidla; nejde o knihovny pro predikci, statistiku ani algebru. Test dependency guard je má v allowlistu s odkazem sem.
8. **`overrides: { vite: ^7.3.7 }`.** Bez pinu `npm install` (npm 10.9.2, bez lockfilu) na vývojovém počítači v adresáři na disku D: opakovaně padá s `Cannot read properties of null (reading 'edgesOut')`; s pinem na Vite 7 instalace projde. Tentýž `package.json` bez pinu se v dočasném adresáři na disku C: nainstaloval (Vite 8.3.5) a všechny testy prošly, takže pád je vázaný na prostředí, ne na kód. Přesnou příčinu v npm jsem nedohledala; že jde o peer závislost Vite 8 `@vitejs/devtools → vitest@*`, je jen domněnka podle posledních řádků logu před pádem. Override jen připíná verzi tranzitivní závislosti, nepřidává novou; dependency guard povoluje právě tento jeden.
9. **Hooks jako Node skripty.** `.claude/hooks/post-edit.mjs` po každé úpravě `.ts/.js` spustí typecheck celého projektu a ESLint na soubor, `stop-check.mjs` při ukončení spustí `typecheck`, `lint` (ESLint + Prettier) a `test` a exit kódem 2 nedovolí skončit. Node místo bash/jq kvůli Windows; Prettier jen ve Stop hooku, aby hook nepřepisoval soubory během editace. Hooky převádějí cestu projektu na kanonickou (`realpathSync.native`), protože z adresáře s malým písmenem disku (`d:\` místo `D:\`) načte Vitest sám sebe dvakrát a všechny testy spadnou.

## Vstup

10. **Timestamp bez časové zóny se čte jako UTC**, samotné datum je půlnoc UTC. Den v týdnu se kontroluje v UTC a rozestup musí být přesně násobek 7 dní, takže „pondělí 00:00“ a „pondělí 12:00“ se nemíchají.
11. **Timestamp je začátek týdne.** Kalendářní pravidla počítají se 7 dny od timestampu; řada s týdny od neděle funguje také (test).
12. **Chybějící týden = chybějící pozorování s vahou 0, ne nula.** Výstup obsahuje proložené hodnoty jen pro týdny přítomné ve vstupu (doslovně podle zadání), doplněné týdny jsou ve varování a v `diagnostics.series.missing_weeks`.
13. **Limity proti nesmyslům:** hodnota nejvýše `Number.MAX_SAFE_INTEGER` (větší čísla už nejsou celé kusy), mřížka nejvýše 10 000 týdnů, tělo nejvýše 10 MB, duplicitní název parametru = 400.
14. **Neznámý parametr = varování, neplatná hodnota známého = 400.** Číselné hodnoty lze poslat i jako text („12“).

## Model

15. **Proč log škála (výchozí transformace).** Řada roste ~400× a rozptyl roste s úrovní; na log škále jsou chyby a zlomy relativní (procentní změna růstu) a predikce nemůže být záporná. Změřeno: v backtestu všech 36 log kandidátů přestřelovalo (průměrný bias +3,6 až +27,0 %, WAPE 14,8–29,5 %) a vyhrál model bez transformace. Příčina není ověřená. Domněnka: log model extrapoluje exponenciální růst, zatímco růst v roce 2021 byl spíš lineární. Starší vysvětlení, že stejnou váhu má chyba z rané fáze, je u kandidátů s poločasem 13 týdnů nepravděpodobné, protože rané týdny mají tehdy skoro nulovou váhu. Proto je transformace dimenzí mřížky a vybírá se backtestem.
16. **Proč ridge přes normální rovnice.** Matice mají nejvýš ~25 sloupců, takže `(XᵀWX + Λ)β = XᵀWz` je rychlé, deterministické a jde napsat i otestovat bez knihoven. Penalizace Λ odpovídá gaussovskému prioru (jako Prophet), takže deset zlomů nepřeučí trend a jednotlivé efekty mají interpretaci.
17. **Řešič: Cholesky, záloha Gauss s částečným pivotem.** Cholesky je pro symetrickou pozitivně definitní matici nejstabilnější a nejjednodušší; když selže, Gauss při téměř nulovém pivotu proměnnou vynuluje místo dělení nulou, takže singulární soustava vrací konečný vektor.
18. **Standardizace t do [0, 1] a z na jednotkový rozsah.** Díky tomu `λ = 1/changepoint_prior_scale²` znamená totéž pro řadu v desítkách i v milionech kusů (škálová nezávislost). Váhy se nenormalizují (nejnovější týden má váhu 1), takže kratší poločas = méně efektivních dat = relativně silnější regularizace.
19. **Zlomy** jsou rovnoměrně v prvních `changepoint_range` historie a jejich počet se omezí tak, aby za každým byla data. Sklon pro extrapolaci je `b + Σδ`, tj. sklon za posledním zlomem.
20. **Slabší penalizace sezónních a kalendářních členů: λ = 0,01** (prior scale 10 jako v Prophetu), absolutní člen a sklon se nepenalizují.
21. **Kalendář jen přes parametr `calendar`.** Pravidla CZ (státní svátky, Velký pátek od roku 2016 podle zákona, Velikonoce anonymním gregoriánským algoritmem) jsou obecná kalendářní fakta, ne data. Regresor pracovních dnů `ln(max(wd, 0,5)/5)` je 0 pro plný týden, takže nemění úroveň běžných týdnů.
22. **Jev bez výskytu v historii** (např. Vánoce v řadě kratší než rok) dostane penalizaci 1e4 k výchozí hodnotě: na log škále koeficient 1 pro pracovní dny (prodej úměrný počtu pracovních dnů), jinak 0; vydá se varování.
23. **Robustní váhy: Huber (c = 1,345), 5 fitů IRLS.** Huber je konvexní, takže IRLS z prvního fitu stabilně konverguje; Tukey by odlehlé body úplně vypnul, ale může skončit v lokálním minimu. Škála reziduí je 1,4826 × vážený MAD s recency vahami, aby rozjezd firmy nenafukoval škálu a nepřestal tlumit nedávné odlehlé týdny.
24. **Recency váhy místo zahazování dat.** `0,5^(stáří/poločas)` od posledního týdne trénovací mřížky; historie zůstává proložená celá, jen její vliv slábne. Poločas 13 týdnů znamená, že model rok 2018 skoro ignoruje, a jeho vlastní proložení začátku řady je proto špatné; řeší to zobrazení historie (bod 42), predikce se tím nemění.
25. **Duanův smearing je vypnutý.** Experiment ve skriptu backtest: na 36 log kandidátech zvýšil průměrný bias z +15,6 % na +19,1 % a WAPE z 21,3 % na 23,3 %, protože log modely už tak přestřelují. Implementace zůstává za konstantou `USE_SMEARING`.
26. **Naivní baseline:** `naive_drift` počítá průměrnou týdenní změnu za posledních 13 týdnů (čtvrtletí), chybu pro intervaly obou naivních modelů z jednotýdenních změn `log1p` za posledních 52 týdnů. Proložené hodnoty naivních modelů jsou jednokrokové predikce.
27. **Dvoustupňová sezónnost (P2) jako dimenze mřížky `seasonality`.** S krátkým poločasem se Fourierův člen fituje jen na posledním půlroce a chová se spíš jako zakřivení trendu než jako roční sezónnost; dvoustupňová varianta odhadne profil z celé historie a úroveň z posledních týdnů. Na ukázkových datech měla nejlepší surové WAPE (11,48 %), ale pravidlo tolerance vybralo jednodušší lokální model (11,70 %). Kvůli reprodukovatelnosti přibyl parametr `seasonality` (auto | local | two_stage) nad rámec zadaného seznamu.
28. **Pojistky proti přetečení:** zpětná transformace omezí z ≤ 40 a výsledek na `[0, MAX_SAFE_INTEGER]`, výstup se zaokrouhlí a ořízne na ≥ 0; ve výstupu tak nikdy není NaN ani Infinity (testy na konstantní řadě, nulách, odlehlých hodnotách a číslech ~1e15).

## Výběr modelu a evaluace

29. **Metriky z nezaokrouhlených predikcí; WAPE pro okno samých nul má jmenovatel 1 kus**, aby zůstalo konečné. Bias je `Σ(f − y)/Σy` v %, kladný = přestřelení (pro čerstvé zboží znamená odpis).
30. **Sezónní kandidát na původu s historií < 104 týdnů se fituje bez sezónnosti**, stejně jako by se choval v provozu. Všichni kandidáti se tak hodnotí na stejných původech; důkaz pro sezónnost ale pochází jen z původů s dlouhou historií (tři nejnovější).
31. **Nejnovější původ u krátké řady** se posune tak, aby měl `min_train_weeks` trénovacích týdnů a kratší testovací okno; teprve když žádný původ nejde, vrátí se `naive_last` (u vynuceného modelu preferovaná regrese) s varováním „nevalidováno“.
32. **Složitost pro pravidlo tolerance:** naive_last 0, naive_drift 0,5, regrese `1 + 2·fourier_order + calendar + two_stage`. Mezi kandidáty do `selection_tolerance` od nejlepšího vyhraje nejnižší složitost, při shodě nižší WAPE.
33. **Nevyplněné dimenze mřížky se hledají, vyplněné se fixují.** `transform` a `calendar` mají hodnoty log a CZ jen tam, kde se nehledá (žádný platný původ backtestu, tedy příliš krátká řada); jinak rozhoduje backtest a na ukázkových datech vyhrálo `none`; `GET /prediction.params` vrací skutečně použité hodnoty, takže jejich opětovné poslání reprodukuje stejný model (test), zadané parametry jsou v `diagnostics.requested_params`.
34. **Pojistka proti podlezení baseline.** Pokud by vybraná regrese měla horší WAPE než nejlepší naivní model, vrátí se baseline s varováním; u vynuceného `model=trend|seasonal` se jen varuje.
35. **Výběr na stejných původech je optimistický.** Vítěz má 11,70 %, ale vnořená validace (výběr se opakuje jen na datech před každým původem) dává 15,31 % proti 16,16 % u `naive_last`. Vnořená validace běží jen ve skriptu backtest, ne v API, protože zdesetinásobí výpočet.

## Intervaly

36. **Interval = střed ± c·z·σ·√h na škále modelu.** σ je robustní směrodatná odchylka reziduí, √h hrubě modeluje růst nejistoty s horizontem. Faktor c se kalibruje kvantilem standardizovaných chyb backtestu, protože nekalibrovaný interval pro šířku 0,75 pokrýval 91,4 % (příliš široký).
37. **Pokrytí se měří leave-one-origin-out**: faktor pro každý původ se kalibruje na ostatních, aby se pokrytí neměřilo na datech, na kterých se kalibrovalo. Na ukázkových datech 74,3 % pro cílových 75 % (70 týdnů). Bez `interval_width` se pokrytí v diagnostice počítá pro šířku 0,75.

## Provoz a monitoring

38. **Persistence:** `data/last-prediction.json` se zapisuje atomicky (dočasný soubor + rename), `data/predictions.jsonl` je append-only s limitem (bod 43); oba soubory jsou v `.gitignore`. Adresář lze změnit proměnnou `DATA_DIR`, testy běží v dočasném adresáři.
39. **Identita řady pro monitoring:** API nemá ID řady, proto záznam nese otisk konce vstupu (poslední týden a hodnotu). Pro monitoring se použije nejnovější dřívější záznam, jehož otisk je v novém vstupu se stejnou hodnotou; záznam ukládá i predikci naivní baseline, aby šlo porovnat realizované WAPE modelu s baseline.
40. **Server poslouchá na `localhost`** (port z `PORT`, výchozí 3000), host lze změnit proměnnou `HOST`.
41. **Graf jako statické SVG** (`out/forecast.svg` ze skriptu backtest) bez knihoven; barvy z validované palety, tooltipy přes `<title>`, světlý i tmavý režim.

## Proložení historie a provoz

42. **Proložení historie: `history_fit=blend` (výchozí), jen zobrazení, ne model.** Diagnostika rozkladem vítěze (poločas 13) na trend, sezónnost a kalendář potvrdila obě hypotézy. H1: trend se zpětně dostane pod nulu (−2 205 ks v týdnu 2018-09-24, −1 705 ks v týdnu 2018-10-22) a výstup se ořízne na 0; lokální Fourier tam navíc přidává ±1 100 ks. H2: kalendář je při `transform=none` absolutní, −2 078 ks za ztracený pracovní den (týden 2019-07-01: 2 792 + 353 − 2 078 = 1 067 ks proti skutečnosti 3 087), Vánoce 2019 −11 183 ks při úrovni ~6 000. Výstup historie proto míchá vybraný model s vahou 0,5^(stáří/poločas) a tentýž model bez recency vah se zbytkem: poslední týden je přesně z vybraného modelu (žádný skok u predikce), staré týdny z modelu, který je vidí. In-sample WAPE proložení kleslo z 15,05 % na 11,95 %, nulové týdny v úseku 2018-09-24..2019-05-06 z 32 na 3. Predikce, intervaly i celý výstup `npm run backtest` jsou beze změny (golden test a `diff` výstupu před a po). Kompromis: výstup historie jsou dvě křivky, ne jeden model, a Vánoce 2020 vycházejí výš (6 997 proti 4 667 ks), protože model bez vah má slabší vánoční efekt.
43. **Zbývající nuly jsou H2 a jejich oprava by vyžadovala změnu modelu, proto není implementovaná.** Týdny 2018-09-24 (svátek 28. 9., −1 000 ks při skutečnosti 43) a 2018-12-31 (Nový rok, −3 839 ks při skutečnosti 599) mají i v modelu bez vah proloženou hodnotu 0. Návrh rozšíření: multiplikativní kalendářní efekty i při `transform=none`, tj. regresor pracovních dnů a svátků násobený odhadem úrovně (např. iterativně z trendu), takže svátek ubere podíl prodejů, ne pevný počet kusů. Změnilo by to model, výběr i predikci, takže patří do další verze s novým backtestem.
44. **`data/predictions.jsonl` drží nejvýše 1 000 nejnovějších záznamů.** Dříve se do souboru jen přidávalo bez hranice; při každém zápisu se teď nad limitem atomicky přepíše posledními 1 000 řádky. Monitoring potřebuje jen nedávné záznamy a 1 000 výpočtů pokryje denní volání po téměř tři roky.
45. **Doba výpočtu a blokování jsou zdokumentované, ne řešené.** Jeden `POST /predict` s ukázkovými daty trvá na vývojovém počítači 0,52–0,82 s (8 měření, `Measure-Command` a Node `fetch`); výběr modelu fituje 74 kandidátů na 7 původech. Server je jednovláknový, `GET /prediction` poslaný během výpočtu čekal 0,42–0,65 s. Pro lokální nástroj s jedním uživatelem to stačí; další krok by byl worker thread.
