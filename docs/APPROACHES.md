# Přístupy k predikci týdenních prodejů

## Kontext a kritéria

- Jedna týdenní řada, 144 týdnů, růst ~400×, rozptyl roste s úrovní. Data obsahují Vánoce (0–4 667 ks proti běžným ~12 000), covidový propad od 2020-03-16 a odlehlé týdny (2019-04-15, 2019-08-05, 2021-03-29 s Velkým pátkem). Jsou v nich jen dvě léta.
- Horizont 10 týdnů (2021-06-28 až 2021-08-30), metrika WAPE, u čerstvého zboží důležitý směr chyby (bias).
- Omezení úkolu: vlastní implementace jádra v Node.js bez knihoven pro statistiku a ML, deterministický výpočet, žádné LLM.
- Hodnocení: rolling-origin backtest se 7 původy (viz README). Čísla jsou průměrné WAPE / bias přes původy.

## 1. Naivní a sezónně naivní modely

- **Co:** poslední hodnota (`naive_last`), poslední hodnota plus průměrná změna (`naive_drift`), stejný týden loni (sezónně naivní).
- **Pro:** triviální, robustní, slouží jako měřítko; každý složitější model musí naivní překonat.
- **Proti:** neumí trend (last) nebo ho přestřelí (drift po skocích), neumí svátky. Sezónně naivní model by kopíroval covid a Vánoce z loňska a při růstu 2–3× za rok je bez úpravy úrovně nepoužitelný.
- **Backtest:** `naive_last` 16,16 % / −7,54 %, `naive_drift` 24,64 % / +2,00 %.

## 2. Exponenciální vyhlazování (Holt, Holt-Winters, ETS)

- **Co:** vážený průměr s exponenciálně klesajícími vahami pro úroveň, trend a sezónnost.
- **Pro:** klasika pro krátkodobé predikce, rychle se adaptuje, málo parametrů, jednoduché na implementaci.
- **Proti:** Holt-Winters potřebuje aspoň dvě celé sezóny a tady je sezóna roční (52 týdnů), takže 104+ týdnů a jen dvě opakování. Svátky a odlehlé týdny nejdou snadno modelovat a ladění parametrů vyhlazování je nelineární optimalizace.
- **Vztah k řešení:** recency váhy v regresi jsou stejná myšlenka („novější data váží víc“) v rámci lineárního modelu.
- **Backtest:** neimplementováno (TODO Dagmar: rozhodnout, zda zmínit jen teoreticky).

## 3. Regrese s trendem, sezónností a kalendářem (vybraná varianta)

- **Co:** `z = a + b·t + Σ δ_k·max(0, t − s_k) + Fourier + kalendář`, vážená ridge regrese, robustní a recency váhy, výběr hyperparametrů backtestem. Je to zjednodušený Prophet napsaný od nuly.
- **Pro:** interpretovatelné koeficienty (sklon, efekt svátku, sezónní amplituda) a jednoduchá vlastní implementace (normální rovnice a Cholesky). Svátky jsou explicitní regresory, odlehlé týdny tlumí robustní váhy. Funguje na libovolné týdenní řadě.
- **Proti:** extrapoluje lineární trend, takže při zrychlení nebo zpomalení růstu se mýlí systematicky (bias). Sezónnost je s dvěma léty slabě podložená a hyperparametry vybrané na stejných původech jsou optimistické.
- **Backtest:**
  - vítěz `transform=none, half_life=13, fourier=1, calendar=CZ`: **11,70 % / −6,39 %**
  - dvoustupňová sezónnost: 11,48 % / −5,89 %, nevybráno kvůli toleranci 3 %
  - nejlepší log model: 14,82 % / +6,45 %
  - vnořená validace celého postupu: **15,31 % / −2,76 %**
- **Zjištění:** kalendář pomáhá (nejlepší bez kalendáře 13,69 %). Recency váhy pomáhají (poločas 13 týdnů je nejlepší) a log škála na těchto datech přestřeluje (změřeno; příčina je jen domněnka, viz níže).

## 4. ARIMA / SARIMA

- **Co:** autoregrese a klouzavé průměry na diferencované řadě, sezónní varianta s periodou 52.
- **Pro:** standard pro řady s autokorelací, dobře popsané intervaly.
- **Proti:** odhad MA členů vyžaduje nelineární optimalizaci (maximální věrohodnost), kterou by bylo nutné napsat ručně. SARIMA s periodou 52 a 144 týdny dat je na hraně identifikovatelnosti. Svátky, covid a zlomy trendu se musí řešit exogenními regresory (ARIMAX), takže se z toho stává regrese s ARIMA chybami.
- **Backtest:** neimplementováno.

## 5. Prophet

- **Co:** knihovna Meta: po částech lineární trend se zlomy, Fourierova sezónnost, svátky, bayesovský odhad (Stan).
- **Pro:** přesně tento typ dat (byznysové řady, svátky, zlomy), dobré výchozí nastavení.
- **Proti:** zadání zakazuje knihovny pro predikci, Prophet navíc vyžaduje Python nebo Stan. Vybrané řešení přebírá jeho strukturu (hinge zlomy, Fourier, prior scale), ale odhad je ridge místo MAP se Stanem a navíc obsahuje recency a robustní váhy.

## 6. Gradient boosting a další ML (XGBoost, LightGBM, neuronové sítě)

- **Co:** strom nebo síť nad příznaky (lagy, kalendář, klouzavé průměry).
- **Pro:** zachytí nelinearity a interakce, silné na velkých datech s mnoha řadami (např. všechny automaty a produkty).
- **Proti:** 144 bodů jedné řady je na ML málo. Stromy neumějí extrapolovat trend mimo rozsah trénovacích dat, a to je u rostoucí firmy zásadní. Vlastní implementace bez knihoven by byla velká a horizont 10 týdnů vyžaduje rekurzivní nebo přímou strategii.
- **Kdy by dávalo smysl:** hierarchie automatů a produktů, exogenní proměnné (počasí, akce, obsazenost kanceláří).

## 7. LLM / Claude API

- **Co:** poslat řadu jazykovému modelu a nechat ho předpovědět čísla.
- **Pro:** rychlý prototyp, umí okomentovat data.
- **Proti:** výsledek není deterministický ani reprodukovatelný a nejde ho poctivě backtestovat (model mohl data vidět). Stojí peníze a latenci a jádro by nebylo vlastní implementací. Zadání LLM v běhu aplikace zakazuje.
- **Kde LLM použito bylo:** při vývoji (Claude Code jako asistent při psaní kódu, testů a dokumentace), viz poznámky Dagmar.

## Souhrnná tabulka

| Přístup | Implementováno | WAPE (backtest) | Bias | Poznámka |
|---|---|---|---|---|
| naive_last | ano (baseline) | 16,16 % | −7,54 % | měřítko |
| naive_drift | ano (baseline) | 24,64 % | +2,00 % | přestřeluje po skocích |
| Regrese (vítěz) | ano | 11,70 % | −6,39 % | vnořená validace 15,31 % |
| Regrese, log škála (nejlepší) | ano | 14,82 % | +6,45 % | přestřeluje (příčina neověřená) |
| Regrese, dvoustupňová sezónnost | ano | 11,48 % | −5,89 % | do tolerance, složitější |
| Holt-Winters / ETS | ne | – | – | |
| SARIMA | ne | – | – | |
| Prophet | ne (zakázáno) | – | – | struktura převzata |
| Gradient boosting / ML | ne | – | – | málo dat |
| LLM | ne (zakázáno) | – | – | nedeterministické |

## Zdůvodnění výběru

**Proč regrese a ne exponenciální vyhlazování nebo ARIMA.**
Nejde o velká data, ale o jednu týdenní řadu se 144 body, silným růstem, svátky a několika odlehlými týdny. Regresní model s po částech lineárním trendem mi dovolil dát do modelu přímo to, co o datech vím: počet pracovních dnů v týdnu, české svátky a týden kolem Vánoc. Ke každému z toho se model naučí vlastní koeficient. U Holt-Wintersova vyhlazování a u ARIMA/SARIMA by roční sezónnost s periodou 52 týdnů potřebovala víc celých cyklů, než mám (necelé tři roky, z toho jeden covidový). Svátky, které padají na různé dny v týdnu, se do nich navíc vkládají hůř. Netvrdím, že by nedopadly stejně dobře. Neimplementovala jsem je ani nesrovnávala, je to můj úsudek, ne naměřený výsledek. Klasické ML jsem zvažovala, ale z jedné řady o 144 bodech by se nemělo z čeho učit a stromové modely neumějí extrapolovat růst nad rozsah, který viděly. Vlastní implementace ridge regrese s vlastním řešičem soustav navíc odpovídá tomu, o co zadání žádá: ukázat, jak přemýšlím, ne zavolat hotovou funkci.

**Co říkají čísla.**
V backtestu na sedmi původech (včetně dvou sezónně odpovídajících) má vítěz průměrné WAPE 11,70 % proti 16,16 % u naivní predikce „stejně jako minulý týden“. Tohle číslo ale vzniklo tak, že se model vybíral na stejných datech, na kterých se měří, takže je optimistické. Poctivější je vnořená validace, kde se výběr opakuje před každým původem: 15,31 %, tedy jen o něco lepší než naivní predikce. Můj závěr je, že model má na těchto datech skromný, ale reálný přínos. Na čtyřech klidnějších původech vychází WAPE 4,6–11,7 %, zatímco v covidovém roce 2020 naivní predikce občas vyhrává (například 6,3 % proti 14,5 % v týdnu od 20. 7. 2020). Kalendář pomáhá: stejný model bez něj má 14,59 % místo 11,70 %. Model systematicky podstřeluje (bias −6 %), což u čerstvého zboží znamená spíš riziko vyprodání než odpisů.

**Proč univerzální řešení a ne řešení ušité na ukázková data.**
Ukázková data jsou záměrně záludná (Vánoce s nulou, covid, odlehlé týdny), ale beru je jako ukázku toho, co může přijít, ne jako zadání pro jedno konkrétní řešení. Kdybych covid nebo konkrétní Vánoce zadrátovala do kódu, fungoval by jen na těchto datech. Proto jsou v modelu obecné mechanismy: robustní váhy, které utlumí odlehlé týdny, váhy podle stáří dat (nedávné týdny váží víc, a přitom se nic nezahazuje), kalendář jako parametr a automatický výběr modelu z backtestu. Moje představa, že se má vycházet hlavně z posledního půlroku a porovnávat „pokračovací“ variantu se sezónní, je v modelu jako poločas vah a řád sezónnosti, o kterých rozhoduje backtest. Služba se při každém volání přetrénuje z dat v požadavku, takže nemůže zastarat. Ukládání předchozích predikcí slouží jen ke kontrole přesnosti v provozu.

**Proč se log škála neosvědčila.**
Teoreticky dávala smysl: řada vyroste zhruba čtyřstokrát a rozptyl roste s úrovní. V backtestu ale všech 36 log kandidátů dopadlo na 14,8–29,5 % WAPE a přestřelovalo (průměrný bias +3,6 až +27,0 %, zaokrouhleně +4 až +27 %), zatímco vyhrál model bez transformace. Součástí backtestu je i experiment s korekcí zpětné transformace (Duanův smearing), který výsledek ještě zhoršil. Proč se to stalo, jsem neověřila. Domnívám se, že log model extrapoluje exponenciální růst, zatímco růst v roce 2021 byl spíš lineární, ale je to hypotéza, ne zjištění. Volbu transformace jsem v kódu nechala otevřenou, takže u jiných dat se může rozhodnout jinak.

**Co dál s více daty.**
- Řady po jednotlivých automatech a produktech a jejich sladění s celkovým součtem (hierarchie), protože zásobování se rozhoduje na úrovni automatů.
- Exogenní proměnné: počet a umístění automatů (růst firmy je z velké části růst sítě), akce, počasí, dovolené.
- Víc let čistých dat, ze kterých půjde odhadnout skutečná roční sezónnost. Dnes jsou v datech dvě léta, z toho jedno covidové.
- Predikovat kvantily místo průměru. U čerstvého zboží stojí podstřelení (vyprodáno) a přestřelení (odpis) jinak, takže ideální cíl není střed rozdělení.
- Až bude dost dat, porovnat s ML (například gradient boosting) jako doplněk k regresi, ne jako náhradu.
