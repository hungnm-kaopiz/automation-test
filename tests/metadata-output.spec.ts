import {
  isRakitaLandingTopPage,
  isRakitaTopPage,
  type SeoMetadata,
} from "./pages/rakita-listing.page.js";
import {
  isArticleCmsPlaceholderValue,
  isArticleDetailPage,
} from "./support/article-cms.js";
import { attachJson } from "./support/attach.js";
import {
  entryToExpectedFields,
  getEntryLabel,
  loadOutputJson,
  type NormalizedFields,
  type OutputEntry,
} from "./support/load-output-json.js";
import { resolveFullUrl } from "./support/navigation.js";
import { expect, test } from "./fixtures.js";

type MatchStatus = "matched" | "failed";

type CompareResult = {
  field: string;
  expected: string;
  actual: string;
  status: MatchStatus;
};

type SeoTextFieldKey = "title" | "description" | "h1" | "breadcrumb";

const FIELD_MAP: Array<{
  key: SeoTextFieldKey;
  expectedKey: keyof NormalizedFields;
  label: string;
}> = [
  { key: "title", expectedKey: "title", label: "titleタグ" },
  { key: "description", expectedKey: "description", label: "Description" },
  { key: "h1", expectedKey: "h1", label: "h1" },
  { key: "breadcrumb", expectedKey: "breadcrumb", label: "パンくずの表記" },
];

function shouldSkipField(
  entry: OutputEntry,
  expectedKey: keyof NormalizedFields,
): boolean {
  const pageUrl = entry.path ?? entry.fullpath;
  const expected = entryToExpectedFields(entry);

  if (
    expectedKey === "breadcrumb" &&
    entry.path?.startsWith("/rakita/facility/") === true
  ) {
    return true;
  }

  if (expectedKey === "h1" && isRakitaLandingTopPage(pageUrl)) {
    return true;
  }

  if (expectedKey === "breadcrumb" && isRakitaTopPage(pageUrl)) {
    return true;
  }

  if (isArticleDetailPage(pageUrl)) {
    if (
      expectedKey === "h1" &&
      expected.h1 &&
      isArticleCmsPlaceholderValue("h1", expected.h1)
    ) {
      return true;
    }
    if (
      expectedKey === "description" &&
      isArticleCmsPlaceholderValue("description", expected.description)
    ) {
      return true;
    }
  }

  return false;
}

/** Split on breadcrumb `>` separators; keep `>` inside HTML-like tags. */
function splitBreadcrumbSegments(value: string): string[] {
  const segments: string[] = [];
  let current = "";

  for (const char of value) {
    if (char === ">") {
      const openAngle = current.lastIndexOf("<");
      const closeAngle = current.lastIndexOf(">");
      const insideTag = openAngle > closeAngle;

      if (insideTag) {
        current += char;
      } else {
        const trimmed = current.trim();
        if (trimmed.length > 0) segments.push(trimmed);
        current = "";
      }
    } else {
      current += char;
    }
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) segments.push(trimmed);
  return segments;
}

function breadcrumbSegmentsEqual(
  expectedTemplate: string,
  actualSegmentsFromDom: string[],
): { ok: true } | { ok: false; reason: string } {
  const expectedSegments = splitBreadcrumbSegments(expectedTemplate);
  const actualSegments = actualSegmentsFromDom.filter(
    (segment) => segment.trim().length > 0,
  );

  if (expectedSegments.length !== actualSegments.length) {
    return {
      ok: false,
      reason: `level count expected ${expectedSegments.length} but got ${actualSegments.length}`,
    };
  }

  for (let i = 0; i < expectedSegments.length; i++) {
    const expectedSegment = expectedSegments[i] ?? "";
    const actualSegment = actualSegments[i] ?? "";
    if (expectedSegment !== actualSegment) {
      return {
        ok: false,
        reason: `level ${i + 1}/${expectedSegments.length} expected "${expectedSegment}" but got "${actualSegment}"`,
      };
    }
  }

  return { ok: true };
}

function compareMetadata(
  entry: OutputEntry,
  expected: NormalizedFields,
  actual: SeoMetadata,
): CompareResult[] {
  return FIELD_MAP.map(({ key, expectedKey, label }) => {
    const expectedRaw = shouldSkipField(entry, expectedKey)
      ? ""
      : (expected[expectedKey] ?? "");
    const actualRaw = actual[key] ?? "";

    if (!expectedRaw) {
      return {
        field: label,
        expected: expectedRaw,
        actual: actualRaw,
        status: "matched",
      };
    }

    let status: MatchStatus = "matched";
    let expectedDisplay = expectedRaw;

    if (expectedKey === "breadcrumb") {
      const result = breadcrumbSegmentsEqual(
        expectedRaw,
        actual.breadcrumbSegments,
      );
      if (!result.ok) {
        status = "failed";
        expectedDisplay = `${expectedDisplay} (${result.reason})`;
      }
    } else if (expectedRaw !== actualRaw) {
      status = "failed";
    }

    return {
      field: label,
      expected: expectedDisplay,
      actual: actualRaw,
      status,
    };
  });
}

function logCompareResults(url: string, results: CompareResult[]): void {
  const failures = results.filter((r) => r.status === "failed");

  if (failures.length === 0) {
    console.log(`✅  All fields matched — ${url}`);
    return;
  }

  console.log(`\n❌  ${failures.length} field(s) failed — ${url}`);
  for (const r of failures) {
    console.log(`   [${r.field}]`);
    console.log(`     expected : ${r.expected}`);
    console.log(`     actual   : ${r.actual || "(element not found)"}`);
  }
}

const SOURCE_FILE = "output.final.json";
const entries = loadOutputJson<OutputEntry>(SOURCE_FILE).filter((entry) =>
  Boolean(entry.path),
);

entries.forEach((entry, index) => {
  test(`[${SOURCE_FILE}] ${index + 1} ${getEntryLabel(entry)}`, async ({
    page,
    rakitaListing,
  }, testInfo) => {
    const pageUrl = entry.path!;
    const testUrl = resolveFullUrl(pageUrl);
    await rakitaListing.open(testUrl);
    const openedUrl = page.url();
    console.log(`🔗  Opened: ${openedUrl}`);

    const actual = await rakitaListing.readSeoMetadata();
    const expectedFields = entryToExpectedFields(entry);
    if (expectedFields.h1 && !isRakitaLandingTopPage(pageUrl)) {
      expect(actual.h1, "Listing H1 must be present").not.toBe("");
    }

    const results = compareMetadata(entry, expectedFields, actual);

    await attachJson(testInfo, "metadata-compare", {
      expectedUrl: testUrl,
      openedUrl,
      expectedFields,
      results,
    });
    logCompareResults(openedUrl, results);

    for (const { key, expectedKey, label } of FIELD_MAP) {
      if (shouldSkipField(entry, expectedKey)) continue;

      const expectedRaw = expectedFields[expectedKey] ?? "";
      if (!expectedRaw) continue;

      if (expectedKey === "breadcrumb") {
        const breadcrumbResult = breadcrumbSegmentsEqual(
          expectedRaw,
          actual.breadcrumbSegments,
        );
        expect(
          breadcrumbResult.ok,
          `[${label}]\n  ${breadcrumbResult.ok ? "" : breadcrumbResult.reason}\n  expected segments: ${splitBreadcrumbSegments(expectedRaw).join(" | ")}\n  actual segments  : ${actual.breadcrumbSegments.join(" | ")}`,
        ).toBe(true);
        continue;
      }

      expect(
        actual[key],
        `[${label}]\n  expected : ${expectedRaw}\n  actual   : ${actual[key] || "(element not found)"}`,
      ).toBe(expectedRaw);
    }
  });
});
