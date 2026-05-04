import * as fs from "node:fs";

import { parse } from "csv-parse/sync";

export type SitemapRow = {
  リダイレクト有無: string | null;
  パンくずの表記: string | null;
  titleタグ: string | null;
  Description: string | null;
  h1: string | null;
  fullpath: string;
};

const FULLPATH_COLS = [
  "ドメイン",
  "第一階層",
  "第二階層",
  "第三階層",
  "第四階層",
  "第五階層",
  "第六階層",
  "第七階層",
  "第八階層",
  "第九階層",
] as const;

function toStringOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function getCell(
  row: string[],
  colIndex: Record<string, number>,
  colName: string,
): string {
  const idx = colIndex[colName];
  if (idx === undefined) return "";
  return row[idx]?.trim() ?? "";
}

export function readSitemap(filePath: string): SitemapRow[] {
  const raw = fs.readFileSync(filePath);

  const records: string[][] = parse(raw, {
    encoding: "utf8",
    bom: true,
    relaxColumnCount: true,
    skipEmptyLines: false,
  });

  if (records.length < 3) {
    throw new Error(
      "CSV does not contain enough rows (need at least 2 header rows + 1 data row).",
    );
  }

  const headers: string[] = records[1]?.map((h) => h.trim()) ?? [];

  const colIndex: Record<string, number> = {};
  headers.forEach((name, idx) => {
    if (name !== "") colIndex[name] = idx;
  });

  const required = [
    "リダイレクト有無",
    ...FULLPATH_COLS,
    "パンくずの表記",
    "titleタグ",
    "Description",
    "h1",
  ];
  for (const col of required) {
    if (colIndex[col] === undefined) {
      console.warn(`⚠️  Column "${col}" not found in CSV headers.`);
    }
  }

  const lastSeen: Partial<Record<(typeof FULLPATH_COLS)[number], string>> = {};
  const results: SitemapRow[] = [];

  for (let i = 2; i < records.length; i++) {
    const row = records[i];
    if (!row || row.every((cell) => cell.trim() === "")) continue;

    for (let ci = 0; ci < FULLPATH_COLS.length; ci++) {
      const col = FULLPATH_COLS[ci];
      if (!col) continue;
      const val = getCell(row, colIndex, col);
      if (val !== "") {
        for (let ri = ci + 1; ri < FULLPATH_COLS.length; ri++) {
          const resetCol = FULLPATH_COLS[ri];
          if (resetCol) delete lastSeen[resetCol];
        }
        lastSeen[col] = val;
      }
    }

    const fullpath = FULLPATH_COLS.map((col) => lastSeen[col] ?? "")
      .filter((v) => v !== "")
      .join("");

    results.push({
      リダイレクト有無: toStringOrNull(
        getCell(row, colIndex, "リダイレクト有無"),
      ),
      パンくずの表記: toStringOrNull(getCell(row, colIndex, "パンくずの表記")),
      titleタグ: toStringOrNull(getCell(row, colIndex, "titleタグ")),
      Description: toStringOrNull(getCell(row, colIndex, "Description")),
      h1: toStringOrNull(getCell(row, colIndex, "h1")),
      fullpath,
    });
  }

  return results;
}
