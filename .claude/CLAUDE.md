1. Jádro predikce píšeš sám, bez knihoven na predikci, statistiku a algebru; allowlist závislostí hlídá test.
2. Žádná data ani data-specifické konstanty v kódu; kalendář jen přes parametr calendar.
3. Nejdřív specifikace (OpenSpec) a úkol (beads), pak test, pak kód.
4. Příkazy nástrojů nepiš z paměti, ověř je v dokumentaci nebo přes --help.
5. Deterministický výpočet, žádná volání LLM, pouze endpointy POST /predict a GET /prediction.
6. Kód anglicky, dokumentace česky; rozhodnutí do docs/DECISIONS.md.
7. Nekonči, dokud neprojdou typecheck, lint a testy.