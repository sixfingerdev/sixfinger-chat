#!/usr/bin/env python3
"""Quick profile of a tabular file: shape, dtypes, missing values, numeric stats, top categories, duplicates.

Usage:
  python3 profile_csv.py FILE [--sep ;] [--encoding cp1254] [--sheet NAME] [--nrows 100000] [--top 5] [--max-cols 60]

FILE may be .csv, .tsv, .txt, .json, .xlsx or .xls. The delimiter and the encoding of text files are
detected when not given. Prints plain text; every number comes from the data.
"""
import argparse
import csv
import io
import sys

import pandas as pd

ENCODINGS = ("utf-8-sig", "utf-8", "cp1254", "cp1252", "latin-1")


def detect_encoding(path):
    raw = open(path, "rb").read(200_000)
    for enc in ENCODINGS:
        try:
            raw.decode(enc)
            return enc
        except UnicodeDecodeError:
            continue
    return "latin-1"


def detect_sep(path, encoding):
    with open(path, encoding=encoding, errors="replace") as f:
        sample = f.read(20_000)
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        return ","


def load(args):
    p = args.file.lower()
    if p.endswith((".xlsx", ".xlsm", ".xls")):
        df = pd.read_excel(args.file, sheet_name=args.sheet or 0, nrows=args.nrows)
        return df, f"excel sheet={args.sheet or 0}"
    if p.endswith(".json"):
        try:
            df = pd.read_json(args.file)
        except ValueError:
            df = pd.read_json(args.file, lines=True)
        return (df.head(args.nrows) if args.nrows else df), "json"
    enc = args.encoding or detect_encoding(args.file)
    sep = args.sep or detect_sep(args.file, enc)
    df = pd.read_csv(args.file, sep=sep, encoding=enc, nrows=args.nrows, low_memory=False)
    return df, f"text encoding={enc} sep={sep!r}"


def main():
    ap = argparse.ArgumentParser(description="Quick profile of a CSV/TSV/JSON/Excel file.")
    ap.add_argument("file")
    ap.add_argument("--sep")
    ap.add_argument("--encoding")
    ap.add_argument("--sheet", help="Excel sheet name (default: first)")
    ap.add_argument("--nrows", type=int, help="read only the first N rows (large files)")
    ap.add_argument("--top", type=int, default=5, help="top values per text column (default 5)")
    ap.add_argument("--max-cols", type=int, default=60, help="describe at most N columns (default 60)")
    args = ap.parse_args()

    try:
        df, how = load(args)
    except FileNotFoundError:
        sys.exit(f"error: file not found: {args.file}")
    except Exception as e:  # unreadable or wrong format
        sys.exit(f"error: cannot read {args.file}: {type(e).__name__}: {e}")

    pd.set_option("display.width", 200)
    pd.set_option("display.max_columns", args.max_cols)
    print(f"File: {args.file}  ({how})")
    note = f"  (first {args.nrows} rows only)" if args.nrows else ""
    print(f"Shape: {df.shape[0]} rows x {df.shape[1]} columns{note}")
    print(f"Memory: {df.memory_usage(deep=True).sum() / 1e6:.1f} MB")
    print(f"Duplicate rows: {int(df.duplicated().sum())}")

    print("\n== Columns ==")
    miss = df.isna().sum()
    for c in list(df.columns)[: args.max_cols]:
        print(f"- {c!s:<30} {str(df[c].dtype):<12} missing={int(miss[c])} ({miss[c] / max(len(df), 1):.1%})  unique={df[c].nunique(dropna=True)}")
    if df.shape[1] > args.max_cols:
        print(f"... {df.shape[1] - args.max_cols} more columns not shown (use --max-cols)")

    num = df.select_dtypes("number")
    if not num.empty:
        print("\n== Numeric columns (describe) ==")
        print(num.iloc[:, : args.max_cols].describe().T.round(3).to_string())

    cat = df.select_dtypes(exclude="number")
    if not cat.empty:
        print(f"\n== Text / other columns (top {args.top} values) ==")
        for c in list(cat.columns)[: args.max_cols]:
            vc = df[c].value_counts(dropna=True).head(args.top)
            items = ", ".join(f"{str(k)[:40]!r}: {v}" for k, v in vc.items())
            print(f"- {c}: {items}")

    print("\n== First 5 rows ==")
    print(df.head().to_string(max_colwidth=30))

    guess = [c for c in cat.columns if df[c].dropna().astype(str).str.match(r"^\d{4}-\d{2}-\d{2}|^\d{1,2}[./]\d{1,2}[./]\d{2,4}").mean() > 0.8]
    if guess:
        print(f"\nPossible date columns (parse with pd.to_datetime): {', '.join(map(str, guess))}")


if __name__ == "__main__":
    main()
