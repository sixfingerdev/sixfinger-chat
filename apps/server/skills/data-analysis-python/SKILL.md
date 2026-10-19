---
name: data-analysis-python
description: Analyzes CSV, JSON or Excel data with pandas and matplotlib - load, explore, clean, group, chart - and delivers a Markdown summary plus CSV/PNG files via share_file. Includes a profile_csv.py script for a fast overview. Use when the user uploads or mentions a data file and wants insights, statistics, trends, charts or a cleaned export. Do not use for building a web dashboard app or a database backend.
triggers: [csv, excel, xlsx, veri, veri analizi, data analysis, analiz, analyze, grafik, chart, plot, tablo, table, istatistik, statistics, pandas, matplotlib, dataset, veri seti, ortalama, average, trend, rapor, report, json]
---

# Data analysis with Python (pandas + matplotlib)

## When to use
- The user gives a data file (uploads are in `.sixfinger/uploads/`) or data in the repo and asks: summarize, find patterns, compare groups, clean, chart, export.
- Questions answerable by computing on tabular data (totals, averages, top N, trends, correlations).

## When NOT to use
- A live web dashboard or app: build it as a web app (then `preview`).
- No data file and no data in the message: ask what data to analyze (`ask_user`) only if it cannot be found with `glob .sixfinger/uploads/*`.

## Golden rule
EVERY number, name and claim in your answer must come from code output you actually saw in this session. Never estimate, round from memory, or "fill in" values. If the data cannot answer the question, say so.

## Workflow
1. `todo`: plan (load, explore, clean, analyze, chart, report, verify).
2. Find the file: `ls -la .sixfinger/uploads/` (also `glob **/*.csv **/*.xlsx **/*.json`). Check size: `ls -lh <file>`. Over ~200 MB: read `references/recipes.md` section 6 first (RAM is about 1 GB).
3. Profile first (do not guess columns):
   `python3 .sixfinger/run/skills/data-analysis-python/scripts/profile_csv.py <file> [--sep ';'] [--encoding cp1254] [--sheet NAME] [--nrows 100000]`
   It prints shape, memory, dtypes, missing values, duplicates, numeric describe, top text values, first rows and possible date columns. It auto-detects the delimiter and encoding. Excel: it reads the first sheet; list sheets with `python3 -c "import pandas as pd; print(pd.ExcelFile('f.xlsx').sheet_names)"`.
4. Read the profile. Write down for the user (in your notes): what each column means, problems found (missing values, wrong dtypes, duplicates, odd values).
5. Plan the analysis around the user's question. Re-read their message; answer THAT question first, extras second.
6. Write the analysis as a script file `analysis/run.py` (not inline `python -c`): copy the tested template from `skill {name: "data-analysis-python", file: "references/recipes.md"}` (cleaning, groupby, pivot, time series, charts, Excel, big files) and adapt it. Run it with `python3 analysis/run.py <file>`.
7. Clean explicitly and report what you did: parse dates/numbers (`errors="coerce"`, then count the NaNs created), strip text, drop duplicates, handle missing values (state: dropped / filled / left). Never drop or fill silently.
8. Charts: `matplotlib.use("Agg")` BEFORE importing pyplot; save PNG files into `analysis/`; `plt.close(fig)`; never `plt.show()`. Title, axis labels, units, sorted bars. Then `read` each PNG to check it is readable and not empty.
9. Outputs go to `analysis/`: `summary.md` (findings, small tables, image links, method and limits), result CSVs (`encoding="utf-8-sig"`), PNGs. Do not overwrite the uploaded file.
10. Deliver: `share_file` for `analysis/summary.md` and each file the user asked for (CSV, PNG, xlsx). For many files: `zip -r analysis.zip analysis` then `share_file analysis.zip`. Give the key numbers in the chat message too.

## Rules
- Read the data before computing: dtypes, units, date format, decimal separator (`,` vs `.`), encoding. Turkish exports: `sep=";"`, `decimal=","`, `encoding="cp1254"` or `utf-8-sig`.
- Print intermediate results (`print(df.shape)`, `print(result)`) so the numbers are visible to you. Do not report a value you did not print.
- Check sample sizes before comparing groups (a mean of 3 rows is weak: say so). Correlation is not causation. Mention missing data share when it matters.
- Keep money/ratio rounding in the output step only, not in intermediate columns.
- Do not install packages unless something is missing; pandas, numpy, matplotlib, openpyxl, yaml are preinstalled. If an import fails: `python3 -m pip install --user <pkg>`; if blocked, tell the user and use what exists (the csv module, plain tables).
- Large result tables: save to CSV, show the top 10 only.
- Do not print a whole DataFrame with more than ~40 rows; use `.head(20)`.
- Never use seaborn/plotly unless already installed and needed; matplotlib is enough.
- No interactive code: no `input()`, no `plt.show()`, no notebooks. Use `python3 file.py`.
- Memory: avoid `df.copy()` chains on big frames; select columns early; use `category` dtype for repeated text; chunk large CSVs.
- Do not invent columns. If a needed column is missing, say which one and what you did instead.

## Common errors
| Symptom | Fix |
|---|---|
| `UnicodeDecodeError` | `--encoding cp1254` / `latin-1`; the profile script tries to detect it. |
| One column with everything glued | Wrong delimiter: `sep=";"` or `"\t"`. |
| `ParserError: Error tokenizing data` | Bad lines: `on_bad_lines="skip"` and report how many were skipped (compare `wc -l`). |
| Numbers read as text | Thousand/decimal separators: clean with `str.replace`, then `pd.to_numeric(errors="coerce")`. |
| Dates wrong (month/day swapped) | Pass `format="%d.%m.%Y"` explicitly or `dayfirst=True`. |
| `KeyError: 'col'` | Hidden spaces/case: `df.columns = df.columns.str.strip()`; print `df.columns.tolist()`. |
| Empty chart | Wrong filter or all-NaN column: print the data before plotting. |
| `ModuleNotFoundError: openpyxl` | Needed only for .xlsx: install with `--user` or ask for CSV. |
| Killed / MemoryError | Chunking, `usecols`, `nrows`; see recipes section 6. |
| Tofu squares in chart text | Use default font (DejaVu supports Turkish); avoid emoji in labels. |

## Verify
- `python3 analysis/run.py <file>` exits 0 and prints the report.
- Cross-check two or three headline numbers a second way (e.g. `awk`/`pandas` one-liner, or `df['x'].sum()` vs the table total).
- `ls -la analysis/` shows every file you will share; `read` the PNGs and `summary.md`.
- Every number in your final message appears in the script output.

## Final answer
In the user's language: 3-6 bullets of findings with the real numbers, what was cleaned or dropped (with counts), the files shared (`analysis/summary.md`, CSV, PNG), and limits (sample size, missing data, assumptions). Do not paste whole tables.
