# Analysis template and pandas recipes

## 1. End-to-end template (tested)
Copy to `analysis/run.py`, then change the column names, the cleaning and the aggregation to match THIS dataset (the columns here are `tarih`, `şehir`, `satış`, `adet`). Run with `python3 analysis/run.py .sixfinger/uploads/<file>.csv`. It writes `analysis/summary.md`, CSVs and PNGs, and prints the report.

```python
"""Template: load -> clean -> aggregate -> charts -> Markdown summary. Every number in the report comes from code."""
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # no display in the sandbox: must come before pyplot
import matplotlib.pyplot as plt
import pandas as pd

SRC = sys.argv[1] if len(sys.argv) > 1 else ".sixfinger/uploads/data.csv"
OUT = Path("analysis")
OUT.mkdir(exist_ok=True)


def md_table(df, floatfmt="{:,.2f}"):
    """DataFrame -> Markdown table (no 'tabulate' dependency)."""
    df = df.reset_index()
    fmt = lambda v: floatfmt.format(v) if isinstance(v, float) else str(v)
    lines = ["| " + " | ".join(map(str, df.columns)) + " |", "|" + "---|" * len(df.columns)]
    lines += ["| " + " | ".join(fmt(v) for v in row) + " |" for row in df.itertuples(index=False)]
    return "\n".join(lines)


# 1. Load (adjust sep/encoding after profile_csv.py told you what the file uses)
df = pd.read_csv(SRC)
rows_raw = len(df)

# 2. Clean: log what you change
df.columns = df.columns.str.strip()
df = df.drop_duplicates()
df["tarih"] = pd.to_datetime(df["tarih"], errors="coerce")
df["şehir"] = df["şehir"].str.strip()
missing_sales = int(df["satış"].isna().sum())
df = df.dropna(subset=["tarih", "şehir", "satış"])  # state this choice in the report
df["gelir"] = df["satış"] * df["adet"]

# 3. Aggregate
by_city = df.groupby("şehir").agg(satir=("gelir", "size"), gelir=("gelir", "sum"), ort_satis=("satış", "mean")).sort_values("gelir", ascending=False)
monthly = df.set_index("tarih")["gelir"].resample("MS").sum()
by_city.to_csv(OUT / "by_city.csv", encoding="utf-8-sig")  # utf-8-sig: Excel opens Turkish characters correctly
monthly.rename("gelir").to_csv(OUT / "monthly.csv", encoding="utf-8-sig")

# 4. Charts: one message per chart, titled, labelled axes, saved to file, figure closed
fig, ax = plt.subplots(figsize=(7, 4))
by_city["gelir"].plot.bar(ax=ax, color="#2a6fdb")
ax.set(title="Revenue by city", xlabel="City", ylabel="Revenue")
ax.tick_params(axis="x", rotation=0)
fig.tight_layout()
fig.savefig(OUT / "revenue_by_city.png", dpi=120)
plt.close(fig)

fig, ax = plt.subplots(figsize=(8, 4))
monthly.plot(ax=ax, marker="o", color="#2a6fdb")
ax.set(title="Monthly revenue", xlabel="Month", ylabel="Revenue")
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(OUT / "monthly_revenue.png", dpi=120)
plt.close(fig)

# 5. Report
top = by_city.index[0]
report = f"""# Sales analysis

Source: `{SRC}`. {rows_raw} rows read, {len(df)} used ({missing_sales} rows without a sales value were dropped).

## Findings
- Total revenue: {df['gelir'].sum():,.0f}.
- Top city: {top} with {by_city.loc[top, 'gelir']:,.0f} ({by_city.loc[top, 'gelir'] / df['gelir'].sum():.1%} of total).
- Best month: {monthly.idxmax():%Y-%m} ({monthly.max():,.0f}).

## Revenue by city
{md_table(by_city)}

![Revenue by city](revenue_by_city.png)
![Monthly revenue](monthly_revenue.png)

## Method and limits
- Duplicates removed; rows with missing date, city or sales dropped.
- Revenue = sales x quantity.
"""
(OUT / "summary.md").write_text(report, encoding="utf-8")
print(report)
```
Notes on the template: the last period of a time series is often partial (say so in the report, or drop it); `utf-8-sig` makes Excel show Turkish characters correctly.

## 2. Cleaning recipes (tested)
```python
# Turkish money text "1.234,50 TL" -> 1234.5
df["fiyat"] = (df["fiyat"].astype("string").str.replace(r"[^\d,.\-]", "", regex=True)
               .str.replace(".", "", regex=False).str.replace(",", ".", regex=False))
df["fiyat"] = pd.to_numeric(df["fiyat"], errors="coerce")      # bad values -> NaN (count them!)
df["tarih"] = pd.to_datetime(df["tarih"], format="%d.%m.%Y", errors="coerce")   # day-first dates
df["ad"] = df["ad"].str.strip()                                  # do NOT use .str.title()/.lower() on Turkish İ/I: it corrupts them
df.columns = df.columns.str.strip()
bad_dates = int(df["tarih"].isna().sum())                        # report how many rows failed
df = df.drop_duplicates()
df["şehir"] = df["şehir"].astype("category")                     # saves memory for repeated text
```
Missing values: say what you did (dropped N rows / filled with median / left as is). Do not fill silently.

Outliers (report them; do not delete without saying so):
```python
q1, q3 = s.quantile([.25, .75]); iqr = q3 - q1
outliers = s[(s < q1 - 1.5 * iqr) | (s > q3 + 1.5 * iqr)]
```

## 3. Analysis recipes (tested)
```python
df.groupby("şehir").agg(n=("satış", "size"), toplam=("satış", "sum"), ort=("satış", "mean")).sort_values("toplam", ascending=False)
df.pivot_table(index="şehir", columns="kategori", values="satış", aggfunc="sum", fill_value=0)
df.set_index("tarih")["satış"].resample("MS").sum()            # monthly ("W" weekly, "D" daily, "YS" yearly)
df["satış"].value_counts(normalize=True, dropna=False)          # shares, including missing
df[["satış", "adet"]].corr().round(3)                            # correlation is not causation: say so
df.nlargest(10, "satış")                                         # top rows
pd.cut(df["yas"], [0, 18, 35, 60, 120], labels=["<18", "18-34", "35-59", "60+"])
df["ay"] = df["tarih"].dt.to_period("M").astype(str)             # month key for groupby
```
- `groupby(...).agg(name=("col", "func"))` is the safe syntax. Reset the index before saving a CSV only if you want the key as a column (`.reset_index()`).
- `SettingWithCopyWarning`: after filtering use `df = df[mask].copy()`.
- Percent change: `s.pct_change()`; rolling mean: `s.rolling(7).mean()`.
- Merge: `a.merge(b, on="id", how="left", validate="m:1")`; compare row counts before and after.

## 4. Charts (matplotlib, tested)
```python
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(8, 4))
ax.hist(df["satış"].dropna(), bins=20, color="#2a6fdb")                 # distribution
ax.scatter(df["adet"], df["satış"], s=12, alpha=0.5)                    # relationship
df.groupby("şehir")["satış"].sum().sort_values().plot.barh(ax=ax)       # ranking
df.boxplot(column="satış", by="şehir", ax=ax)                           # spread per group
ax.set(title="...", xlabel="...", ylabel="...")
fig.tight_layout(); fig.savefig("analysis/chart.png", dpi=120); plt.close(fig)
```
- Chart choice: trend over time = line; ranking = horizontal bar; share (<=5 parts) = bar with percentages (avoid pie); distribution = histogram; two numbers = scatter.
- Bar charts start at 0. Sort bars. Label axes with units. At most ~8 colours. One idea per chart.
- Long category labels: `barh`, or `ax.tick_params(axis="x", rotation=45)`.
- Always `plt.close(fig)` in loops (memory).
- Check the PNG with `read` (it shows images) before sharing.

## 5. Excel / files
```python
with pd.ExcelWriter("analysis/result.xlsx") as w:            # needs openpyxl (preinstalled)
    by_city.to_excel(w, sheet_name="by_city")
    df.head(1000).to_excel(w, sheet_name="sample", index=False)
pd.ExcelFile(path).sheet_names                                 # list sheets before reading
pd.read_excel(path, sheet_name="Sheet1", header=2)             # header row is the 3rd line
pd.read_csv(path, sep=";", decimal=",", encoding="cp1254")     # Turkish/European exports
pd.read_json(path, lines=True)                                 # one JSON object per line
```
- Nested JSON: `pd.json_normalize(data, record_path="items", meta=["id"])`.
- Never overwrite the user's upload: write results to `analysis/`.

## 6. Big files (RAM about 1 GB)
- Check size first: `ls -lh file; wc -l file`. A CSV expands about 3-10x in memory.
- Read only what you need: `pd.read_csv(p, usecols=[...], dtype={"id": "int32", "kategori": "category"}, nrows=100000)`.
- Stream: `for chunk in pd.read_csv(p, chunksize=200_000): partial = chunk.groupby("k")["v"].sum(); parts.append(partial)`, then `pd.concat(parts).groupby(level=0).sum()`. Only sums/counts/min/max combine this way; compute a mean as sum/count.
- Over ~500 MB: profile with `--nrows 100000` first, and tell the user the analysis used chunks or a sample.
- `MemoryError` or a killed process: reduce columns/rows, use chunks, or sample with `skiprows=lambda i: i > 0 and random.random() > 0.1`.
