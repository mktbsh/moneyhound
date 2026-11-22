# Third-party notices

moneyhound is a private app. The notes below are for traceability.

## ossannote2025/mf-csv-viewer

<https://github.com/ossannote2025/mf-csv-viewer>

`src/domain/importers/encoding.ts` and the Money Forward 「収入・支出詳細」 column matching in `src/domain/importers/mfCsv.ts` are adapted from this project (header folding, amount punctuation, UTF-8 / UTF-16 / Shift_JIS detection, and the `計算対象` / `振替` / `ID` columns). The surrounding ledger model is original.

```
MIT License

Copyright (c) 2026 ossannote2025

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Consulted, not copied

These repositories were reviewed while choosing the importer boundary. Their source is not included in this phase.

- `pnsk-lab/mnie` — provider/adapter split, normalized account and transaction fields, and stable external references. Login, session, cookie, and passkey code was not copied and must not be added.
- `fukuokacolor-web/mf-categorizer` — contains-match category rules. The rule engine here is a separate implementation.
- `hatappi-area/kakeibo` and `kyuki3rain/kakeibo-viewer` — household ledger ideas (income, expense, transfer, later budgets). No source was copied.
- `yukihiko-shinoda/zaim-csv-converter` and `nonisgh/card-summary` — future institution CSV column maps (WAON, 三井住友カード, and similar). Those parsers are not in this repository yet.
