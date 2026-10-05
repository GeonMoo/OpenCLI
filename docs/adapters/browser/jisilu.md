# Jisilu

Read convertible bond tables using the existing Chrome session:

```sh
opencli jisilu login
opencli jisilu whoami
opencli jisilu list -f csv -o test.csv
opencli jisilu redeem
opencli jisilu adjust
opencli jisilu put
opencli jisilu pre
opencli jisilu delisted
```

`login` opens the login page and waits for manual authentication, or reports an existing logged-in session. Data commands default to all rows in the page's default order; `--limit 3` limits the output.

The adapter reads the Vue state used by the visible tables (DOM_STATE), without replaying undocumented endpoints. Each data command exports 12 primary fields. Unavailable and member-only values remain null. Percentage fields use percentage points; amount fields ending in `Cny100M` use 100 million CNY (亿元). In `pre`, `stockPrice` is the stock price, and unissued bonds may have no bond code or name.

To export and verify all eight commands in PowerShell:

```powershell
New-Item -ItemType Directory -Path exports -Force | Out-Null
foreach ($command in 'login','whoami','list','redeem','adjust','put','pre','delisted') {
    opencli jisilu $command -f csv -o "exports/jisilu-$command.csv"
    if ($LASTEXITCODE -ne 0) { throw "$command export failed" }
}
Copy-Item exports/jisilu-list.csv test.csv
python scripts/verify-jisilu-csv.py
```

CSV files written with `-o` contain one UTF-8 BOM. The verification script checks strict UTF-8 decoding, Chinese names, six-digit identity codes, column counts and CSV roundtripping, including multiline fields. It writes a local report to `exports/jisilu-csv-validation.json`.

Live validation on 2026-10-05: all eight commands exported successfully; list/redeem/adjust/put/pre/delisted returned 310/319/319/319/84/732 rows. Counts and sampled identities/prices matched the visible tables. Login was tested with an existing authenticated session; first-time credential entry was not exercised.
