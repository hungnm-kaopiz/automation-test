import { readFileSync } from "node:fs";
import path from "node:path";

export type NormalizedFields = {
  fullpath: string;
  title: string;
  description: string;
  h1?: string;
  breadcrumb?: string;
};

/** Flat SEO row shape shared by output.json and output.final.json. */
export type OutputEntry = {
  fullpath: string;
  path?: string;
  scope?: string;
  リダイレクト有無?: string | null;
  titleタグ: string;
  Description: string;
  h1?: string;
  パンくずの表記?: string;
  [key: string]: unknown;
};

export function entryToExpectedFields(entry: OutputEntry): NormalizedFields {
  const fields: NormalizedFields = {
    fullpath: entry.fullpath,
    title: entry.titleタグ,
    description: entry.Description,
  };

  if (entry.h1) fields.h1 = entry.h1;
  if (entry.パンくずの表記) fields.breadcrumb = entry.パンくずの表記;

  return fields;
}

export function loadOutputJson<T>(filename: string): T[] {
  const outputPath = path.resolve(process.cwd(), filename);

  try {
    return JSON.parse(readFileSync(outputPath, "utf8")) as T[];
  } catch (err) {
    throw new Error(`Failed to load ${filename} at "${outputPath}": ${err}`);
  }
}

export function getEntryLabel(entry: OutputEntry): string {
  if (entry.path) return entry.path;
  try {
    return new URL(entry.fullpath).pathname;
  } catch {
    return entry.fullpath;
  }
}
