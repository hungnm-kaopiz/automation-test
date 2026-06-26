import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type RawItem = {
  titleタグ: string;
  Description: string;
  h1?: string;
  パンくずの表記?: string;
  fullpath: string;
  scope?: string;
  path?: string;
  [key: string]: unknown;
};

export type NormalizedItem = RawItem;

const BASE_URL = "http://localhost:3000/";

// ===== JP → EN SLOT MAP (SOURCE OF TRUTH) =====
const JP_TO_EN_SLOT_MAP: Record<string, string> = {
  障がい種別: "disability",
  対応している障がい種別全てを記載: "supportedDisabilities",
  タグ名: "tag",
  タグ名1: "tag1",
  タグ名2: "tag2",
  事業所名: "facilityName",
  会社名: "companyName",
  企業名: "corporateName",
  カテゴリ名: "categoryName",
  SEOタイトル: "seoTitle",
  seoタイトル: "seoTitle",
};

// ===== BASE SLOTS =====
const BASE_SLOTS = ["count", "prefecture", "city", "ward", "station", "line"];

// ===== ALLOWED SLOTS = base + mapping values =====
const ALLOWED_SLOTS = new Set([
  ...BASE_SLOTS,
  ...Object.values(JP_TO_EN_SLOT_MAP),
]);

// ===== HELPERS =====
const extractSlots = (str: string): string[] => {
  const matches = str.match(/\{([^{}]+)\}/g) || [];
  return matches.map((m) => m.slice(1, -1));
};

const assertValidBraces = (str: string) => {
  const open = (str.match(/\{/g) || []).length;
  const close = (str.match(/\}/g) || []).length;
  if (open !== close) {
    throw new Error(`❌ Unbalanced braces\n👉 ${str}`);
  }
};

const assertNoUnknownSlots = (str: string) => {
  const slots = extractSlots(str);
  const unknown = slots.filter((s) => !ALLOWED_SLOTS.has(s));
  if (unknown.length > 0) {
    throw new Error(`❌ Unknown slots: ${unknown.join(", ")}\n👉 ${str}`);
  }
};

const JP_SLOT_ENTRIES = Object.entries(JP_TO_EN_SLOT_MAP).sort(
  ([a], [b]) => b.length - a.length,
);

/** 〇〇 → EN slots without 県/市/区 suffix (master data values already include them). */
const applyLocationSlots = (input: string): string =>
  input
    .replace(/〇〇件/g, "{count}件")
    .replace(/\d+件/g, "{count}件")
    .replace(/〇〇県/g, "{prefecture}")
    .replace(/〇〇市/g, "{city}")
    .replace(/〇〇区/g, "{ward}")
    .replace(/〇〇駅/g, "{station}")
    .replace(/〇〇線/g, "{line}");

/** JP label → EN slot name ({タグ名} / bare タグ名). */
const applyJpSlots = (input: string): string => {
  let out = input;
  for (const [jp, en] of JP_SLOT_ENTRIES) {
    out = out
      .replace(new RegExp(`\\{${jp}\\}`, "g"), `{${en}}`)
      .replace(new RegExp(jp, "g"), `{${en}}`);
  }
  return out;
};

/** App joins multiple tag labels with 、; SEO.csv uses ASCII comma between slots. */
const applyTagListSeparator = (input: string): string =>
  input.replace(/\{tag(\d*)\},\{tag(\d*)\}/g, "{tag$1}、{tag$2}");

const normalizeBracketInner = (inner: string): string =>
  applyJpSlots(applyLocationSlots(inner));

/** App renders listing title suffix as " | らきた" (spaces around pipe). */
const normalizeTitlePipeSuffix = (input: string): string =>
  input.replace(/\s*\|\s*らきた/g, " | らきた");

/** SEO.csv title: full-width （） around tag(s), except root /station/.../tag/ which uses half-width (). */
export function getTitleListingParenStyle(
  rawTitleTemplate: string,
): "full" | "half" | "none" {
  if (/一覧（/.test(rawTitleTemplate)) return "full";
  if (/一覧\(/.test(rawTitleTemplate)) return "half";
  return "none";
}

export function assertResolvedTitleParenStyle(
  rawTitleTemplate: string,
  resolvedTitle: string,
  entryPath: string,
): void {
  const style = getTitleListingParenStyle(rawTitleTemplate);
  if (style === "none") return;

  const hasFull = /一覧（.+） \| らきた$/.test(resolvedTitle);
  const hasHalf = /一覧\(.+\) \| らきた$/.test(resolvedTitle);

  if (style === "full" && !hasFull) {
    throw new Error(
      `[title paren] ${entryPath} expects full-width （） in title tag, got: ${resolvedTitle}`,
    );
  }
  if (style === "half" && !hasHalf) {
    throw new Error(
      `[title paren] ${entryPath} expects half-width () in title tag, got: ${resolvedTitle}`,
    );
  }
}

// ===== CORE NORMALIZE =====
const normalizeSeoString = (input: string): string => {
  if (!input) return input;

  let normalized = input
    // normalize full-width curly braces (slots only; keep （） as in SEO.csv / app)
    .replace(/｛/g, "{")
    .replace(/｝/g, "}")
    // 【〇〇県〇〇市〇〇区】 → 【{prefecture}{city}{ward}】 (must run before whole-string pass)
    .replace(
      /【([^【】]+)】/g,
      (_, inner) => `【${normalizeBracketInner(inner)}】`,
    );

  normalized = applyLocationSlots(normalized);
  normalized = applyJpSlots(normalized);
  normalized = applyTagListSeparator(normalized);

  // ===== GUARDS =====

  // 🚨 unhandled 〇〇
  if (normalized.includes("〇〇")) {
    throw new Error(`❌ Unhandled 〇〇 placeholder\n👉 ${input}`);
  }

  // 🚨 JP token còn sót dạng bracket lạ
  Object.keys(JP_TO_EN_SLOT_MAP).forEach((jp) => {
    const suspiciousPatterns = [
      new RegExp(`[\\[【「]${jp}[\\]】」]`),
      new RegExp(`\\(${jp}\\)`),
    ];
    if (suspiciousPatterns.some((r) => r.test(normalized))) {
      throw new Error(
        `❌ Unconverted JP token (wrong bracket): "${jp}"\n👉 ${input}`,
      );
    }
  });

  // 🚨 brace balance
  assertValidBraces(normalized);

  // 🚨 unknown slots
  assertNoUnknownSlots(normalized);

  return normalized;
};

const toTestFullpath = (fullpath: string): string => {
  const trimmed = fullpath.trim();
  let pathname: string;
  try {
    pathname = new URL(trimmed).pathname;
  } catch {
    pathname = trimmed;
  }
  const relative = pathname.replace(/^\/+/, "");
  const suffix = relative.endsWith("/") ? "" : "/";
  return `${BASE_URL}${relative}${suffix}`;
};

export const normalizeItem = (item: RawItem): NormalizedItem => {
  const result: NormalizedItem = {
    ...item,
    fullpath: toTestFullpath(item.fullpath),
    titleタグ: normalizeTitlePipeSuffix(normalizeSeoString(item.titleタグ)),
    Description: normalizeSeoString(item.Description),
  };

  if (item.h1) {
    result.h1 = normalizeSeoString(item.h1);
  }

  if (item.パンくずの表記) {
    result.パンくずの表記 = normalizeSeoString(item.パンくずの表記);
  }

  return result;
};

function runCli(): void {
  const inputPath = path.resolve(
    __dirname,
    process.env["SEO_INPUT"] ?? "./output.json",
  );

  const raw = fs.readFileSync(inputPath, "utf-8");
  const data: RawItem[] = JSON.parse(raw);

  console.log(`📥 Loaded ${data.length} items`);

  data.forEach((item, index) => {
    try {
      normalizeItem(item);
    } catch (err) {
      console.error(`\n🔥 Error at index ${index}`);
      console.error(`Path: ${item.path}`);
      console.error(`Fullpath: ${item.fullpath}`);
      throw err;
    }
  });

  console.log("✅ All items normalized");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
