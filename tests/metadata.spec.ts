import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

type MetadataRow = {
  redirectStatus: string;
  domain: string;
  firstLevel: string;
  secondLevel: string;
  thirdLevel: string;
  fourthLevel: string;
  fifthLevel: string;
  sixthLevel: string;
  seventhLevel: string;
  eighthLevel: string;
  ninthLevel: string;
  urlMeaning: string;
  pageType: string;
  contentDefinitionId: string;
  breadcrumb: string;
  title: string;
  description: string;
  h1: string;
};

type Scenario = {
  name: string;
  path: string;
  rowMatcher: (row: MetadataRow) => boolean;
  assertH1?: boolean;
  skip?: Partial<
    Record<"breadcrumb" | "description" | "h1" | "title", boolean>
  >;
};

const metadataRows = loadMetadataRows();

const scenarios: Scenario[] = [
  {
    name: "Rakita TOP",
    path: "/rakita/",
    rowMatcher: (row) => row.urlMeaning === "TOP",
    assertH1: false,
    skip: { breadcrumb: true },
  },
  {
    name: "Rakita prefecture listing",
    path: "/rakita/1",
    rowMatcher: (row) =>
      row.urlMeaning === "県番号" && row.pageType === "全種事業所一覧",
    assertH1: true,
  },
  {
    name: "Rakita station listing",
    path: "/rakita/19/station/36084",
    rowMatcher: (row) =>
      row.urlMeaning === "駅周辺の一覧" && row.pageType === "全種事業所一覧",
    assertH1: true,
  },
  {
    name: "Rakita line listing",
    path: "/rakita/19/lines/11402",
    rowMatcher: (row) =>
      row.urlMeaning === "路線の一覧" && row.pageType === "全種事業所一覧",
    assertH1: true,
  },
  {
    name: "Rakita A facility detail",
    path: "/rakita/facility/67",
    rowMatcher: (row) => row.urlMeaning === "A型の事業所ページ",
    assertH1: false,
    skip: { description: true },
  },
  {
    name: "Rakita corporate detail",
    path: "/rakita/facility_corporate/1",
    rowMatcher: (row) => row.urlMeaning === "運営会社特設ページ",
    assertH1: false,
  },
  {
    name: "Rakita articles landing",
    path: "/rakita/articles",
    rowMatcher: (row) => row.urlMeaning === "記事TOP",
    assertH1: false,
  },
  {
    name: "Rakita article category",
    path: "/rakita/articles/category/wzexok1n_ue",
    rowMatcher: (row) => row.urlMeaning === "カテゴリ内記事一覧",
    assertH1: false,
  },
  {
    name: "Rakita article tag",
    path: "/rakita/articles/tag/rm9q1lq5zn",
    rowMatcher: (row) => row.urlMeaning === "タグ内記事一覧",
    assertH1: false,
  },
];

for (const scenario of scenarios) {
  test(scenario.name, async ({ page }, testInfo) => {
    const row = findMetadataRow(
      metadataRows,
      scenario.rowMatcher,
      scenario.name,
    );

    await page.goto(scenario.path, { waitUntil: "domcontentloaded" });

    const rawBreadcrumb = scenario.skip?.breadcrumb
      ? ""
      : await page
          .getByRole("navigation", { name: "breadcrumb" })
          .first()
          .innerText();

    const actual = {
      title: await page.title(),
      description:
        (await page
          .locator('meta[name="description"]')
          .getAttribute("content")) ?? "",
      h1: scenario.assertH1 ? await page.locator("h1").first().innerText() : "",
      breadcrumb: scenario.skip?.breadcrumb
        ? ""
        : await getBreadcrumbDisplay(page),
    };

    await testInfo.attach("page-output", {
      contentType: "text/markdown",
      body: buildSnapshotMarkdown(scenario.name, scenario.path, row, actual),
    });

    if (!scenario.skip?.title) {
      await assertTemplateMatch(
        actual.title,
        row.title,
        `${scenario.name} title`,
      );
    }

    if (!scenario.skip?.description) {
      await assertTemplateMatch(
        actual.description,
        row.description,
        `${scenario.name} description`,
      );
    }

    if (scenario.assertH1) {
      await assertTemplateMatch(actual.h1, row.h1, `${scenario.name} h1`);
    }

    if (!scenario.skip?.breadcrumb) {
      await assertBreadcrumbMatch(
        rawBreadcrumb,
        row.breadcrumb,
        `${scenario.name} breadcrumb`,
      );
    }
  });
}

async function assertBreadcrumbMatch(
  actual: string,
  expected: string,
  label: string,
): Promise<void> {
  const normalizedExpected = normalizeText(expected).replace(/\s*>\s*/g, " ");
  const normalizedActual = normalizeText(actual).replace(/\s*>\s*/g, " ");

  expect(normalizedActual, label).toMatch(templateToRegExp(normalizedExpected));
}

async function getBreadcrumbDisplay(page: Page): Promise<string> {
  const breadcrumbText = await page
    .getByRole("navigation", { name: "breadcrumb" })
    .first()
    .innerText();

  return breadcrumbText
    .split(/\r?\n+/)
    .map((text: string) => normalizeText(text))
    .filter((text: string) => text.length > 0)
    .join(" > ");
}

function buildSnapshotMarkdown(
  scenarioName: string,
  path: string,
  expected: MetadataRow,
  actual: {
    title: string;
    description: string;
    h1: string;
    breadcrumb: string;
  },
): string {
  const fullUrl = `http://localhost:3000${path}`;

  return [
    `# ${scenarioName}`,
    "",
    `- URL: ${fullUrl}`,
    "",
    "## Expected",
    "",
    `- Title: ${expected.title || "(empty)"}`,
    `- Description: ${expected.description || "(empty)"}`,
    `- H1: ${expected.h1 || "(empty)"}`,
    `- Breadcrumb: ${expected.breadcrumb || "(empty)"}`,
    "",
    "## Actual",
    "",
    `- Title: ${actual.title || "(empty)"}`,
    `- Description: ${actual.description || "(empty)"}`,
    `- H1: ${actual.h1 || "(empty)"}`,
    `- Breadcrumb: ${actual.breadcrumb || "(empty)"}`,
  ].join("\n");
}

function loadMetadataRows(): MetadataRow[] {
  const csvPath = path.resolve(process.cwd(), "metadata.csv");
  const csvText = readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const lines = csvText
    .split(/\r?\n/)
    .map((line: string) => line.trimEnd())
    .filter((line: string) => line.trim().length > 0);

  const headerLineIndex = lines.findIndex(
    (line: string) =>
      line.includes("リダイレクト有無") && line.includes("titleタグ"),
  );

  if (headerLineIndex < 0) {
    throw new Error("metadata.csv header row was not found");
  }

  const headers = parseCsvLine(lines[headerLineIndex]).map((header) =>
    header.trim(),
  );
  const rows: MetadataRow[] = [];

  for (const line of lines.slice(headerLineIndex + 1)) {
    const values = parseCsvLine(line);

    if (values.every((value) => value.trim() === "")) {
      continue;
    }

    const record = createRecord(headers, values);

    rows.push({
      redirectStatus: record["リダイレクト有無"] ?? "",
      domain: record["ドメイン"] ?? "",
      firstLevel: record["第一階層"] ?? "",
      secondLevel: record["第二階層"] ?? "",
      thirdLevel: record["第三階層"] ?? "",
      fourthLevel: record["第四階層"] ?? "",
      fifthLevel: record["第五階層"] ?? "",
      sixthLevel: record["第六階層"] ?? "",
      seventhLevel: record["第七階層"] ?? "",
      eighthLevel: record["第八階層"] ?? "",
      ninthLevel: record["第九階層"] ?? "",
      urlMeaning: record["URLの意味"] ?? "",
      pageType: record["ページタイプ"] ?? "",
      contentDefinitionId: record["コンテンツ定義ID"] ?? "",
      breadcrumb: record["パンくずの表記"] ?? "",
      title: record["titleタグ"] ?? "",
      description: record["Description"] ?? "",
      h1: record["h1"] ?? "",
    });
  }

  return rows;
}

function createRecord(
  headers: string[],
  values: string[],
): Record<string, string> {
  const record: Record<string, string> = {};

  headers.forEach((header, index) => {
    record[header] = (values[index] ?? "").trim();
  });

  return record;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let isInsideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (isInsideQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        isInsideQuotes = !isInsideQuotes;
      }

      continue;
    }

    if (character === "," && !isInsideQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function findMetadataRow(
  rows: MetadataRow[],
  matcher: (row: MetadataRow) => boolean,
  scenarioName: string,
): MetadataRow {
  const row = rows.find(matcher);

  if (!row) {
    const availableRows = rows
      .map((item) => `${item.urlMeaning} | ${item.pageType} | ${item.title}`)
      .slice(0, 10)
      .join("\n");

    throw new Error(
      `Could not find a metadata row for ${scenarioName}.\n\nFirst rows:\n${availableRows}`,
    );
  }

  return row;
}

function normalizeText(value: string): string {
  return value
    .replace(/\u3000/g, " ")
    .replace(/障がい/g, "障害")
    .replace(/\s+/g, " ")
    .trim();
}

function templateToRegExp(template: string): RegExp {
  const normalizedTemplate = normalizeText(template);
  const wildcard = "___WILDCARD___";
  const optionalCounty = "___WILDCARD_OPTIONAL_KEN___";
  const optionalCity = "___WILDCARD_OPTIONAL_CITY___";
  const optionalWard = "___WILDCARD_OPTIONAL_WARD___";
  const optionalStation = "___WILDCARD_OPTIONAL_STATION___";
  const placeholders = [
    "120文字前後で記事毎に設定",
    "seoタイトル",
    "h1タイトル",
    "事業所名",
    "会社名",
    "ブランド名",
    "企業名",
    "カテゴリ名",
    "タグ名1",
    "タグ名2",
    "タグ名",
    "障がい種別",
    "〇〇",
  ].sort((left, right) => right.length - left.length);

  let rewritten = normalizedTemplate;

  rewritten = rewritten.replace(/【[^】]+】/g, wildcard);
  rewritten = rewritten.replace(/\([^()]+\)/g, wildcard);
  rewritten = rewritten.replace(/〇〇県/g, optionalCounty);
  rewritten = rewritten.replace(/〇〇市/g, optionalCity);
  rewritten = rewritten.replace(/〇〇区/g, optionalWard);
  rewritten = rewritten.replace(/〇〇駅/g, optionalStation);

  for (const placeholder of placeholders) {
    rewritten = rewritten.split(placeholder).join(wildcard);
  }

  rewritten = rewritten.replace(/\{[^}]+\}/g, wildcard);

  const escaped = rewritten.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexSource = `^${escaped
    .split(optionalCounty)
    .join(".+?(?:県)?")
    .split(optionalCity)
    .join(".+?(?:市)?")
    .split(optionalWard)
    .join(".+?(?:区)?")
    .split(optionalStation)
    .join(".+?(?:駅)?")
    .split(wildcard)
    .join(".+?")}$`;

  return new RegExp(regexSource);
}

async function assertTemplateMatch(
  actual: string | (() => Promise<string>),
  expected: string,
  label: string,
): Promise<void> {
  const normalizedExpected = normalizeText(expected);

  if (!normalizedExpected) {
    return;
  }

  if (typeof actual === "function") {
    await expect
      .poll(async () => normalizeText(await actual()), {
        timeout: 15000,
        message: label,
      })
      .toMatch(templateToRegExp(normalizedExpected));
    return;
  }

  expect(normalizeText(actual), label).toMatch(
    templateToRegExp(normalizedExpected),
  );
}
