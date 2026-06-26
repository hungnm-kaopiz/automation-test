import { APP_BASE_URL } from "./navigation.js";

export type SeoTechnicalMetadata = {
  htmlLang: string;
  robots: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogUrl: string;
  ogType: string;
  ogImage: string;
  twitterCard: string;
  twitterTitle: string;
  twitterDescription: string;
  jsonLd: string[];
};

export type SeoPageKind = "listing" | "full";

export type TechnicalCheckResult = {
  field: string;
  expected: string;
  actual: string;
  status: "matched" | "failed";
};

const RAKITA_ORIGIN = `${APP_BASE_URL.replace(/\/+$/, "")}/rakita`;
const TITLE_SUFFIX_PATTERN = /\s*\|\s*らきた\s*$/;

function normalizeTitleForSocial(title: string): string {
  return title.replace(TITLE_SUFFIX_PATTERN, "");
}

function normalizeCanonicalPath(path: string): string {
  if (!path || path === "/") return "/";

  const normalized = path.startsWith("/") ? path : `/${path}`;

  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

/** Map output entry path (/rakita/…) to app-internal route path (/keizoku/…). */
export function entryPathToAppPath(entryPath: string): string {
  let path = entryPath.replace(/\/+$/, "");
  if (path === "/rakita" || path === "") return "/";

  if (path.startsWith("/rakita/")) {
    path = path.slice("/rakita".length);
  }

  if (!path.startsWith("/")) path = `/${path}`;

  return path === "" ? "/" : path;
}

export function buildExpectedCanonicalUrl(entryPath: string): string {
  const appPath = entryPathToAppPath(entryPath);
  const canonicalPath = normalizeCanonicalPath(appPath);

  if (canonicalPath === "/") return RAKITA_ORIGIN;

  return `${APP_BASE_URL.replace(/\/+$/, "")}/rakita${canonicalPath}`;
}

export function normalizeUrlForCompare(url: string): string {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    const path = normalizeCanonicalPath(parsed.pathname);

    return path === "/" ? `${parsed.origin}/rakita` : `${parsed.origin}${path}`;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

function isResolvableArticlePath(normalized: string): boolean {
  if (normalized === "/rakita/articles") return true;
  if (/^\/rakita\/articles\/category\/[^/]+$/.test(normalized)) return true;
  if (/^\/rakita\/articles\/tag\/[^/]+$/.test(normalized)) return true;
  if (/^\/rakita\/articles\/(?!category|tag)[^/]+$/.test(normalized)) return true;

  return false;
}

export function classifySeoPageKind(path: string): SeoPageKind {
  const normalized = path.replace(/\/+$/, "") || "/rakita";

  if (normalized.startsWith("/rakita/articles")) {
    return isResolvableArticlePath(normalized) ? "full" : "listing";
  }

  if (normalized === "/rakita") return "full";

  if (/^\/rakita\/(keizoku|ikou)$/.test(normalized)) return "full";
  if (/^\/rakita\/keizoku\/type_[ab]$/.test(normalized)) return "full";
  if (/^\/rakita\/facility\/\d+$/.test(normalized)) return "full";
  if (/^\/rakita\/facility_corporate\/\d+$/.test(normalized)) return "full";

  return "listing";
}

function isUnresolvedArticleTemplate(path: string): boolean {
  const normalized = path.replace(/\/+$/, "");
  return normalized === "/rakita/articles/category" || normalized === "/rakita/articles/tag";
}

function extractFacilityCount(description: string): number | null {
  const match = description.match(/(\d+)件/);
  return match ? Number(match[1]) : null;
}

function expectedListingRobots(description: string): string {
  const count = extractFacilityCount(description);
  if (count === null) return "index, follow";

  return count > 0 ? "index, follow" : "noindex, nofollow";
}

function robotsTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[,\s]+/)
      .filter(Boolean),
  );
}

function robotsEquivalent(expected: string, actual: string): boolean {
  const expectedTokens = robotsTokens(expected);
  const actualTokens = robotsTokens(actual);
  if (expectedTokens.size !== actualTokens.size) return false;

  for (const token of expectedTokens) {
    if (!actualTokens.has(token)) return false;
  }

  return true;
}

function isValidRobotsValue(value: string): boolean {
  const tokens = robotsTokens(value);
  if (tokens.size === 0) return false;

  const hasIndex = tokens.has("index");
  const hasNoindex = tokens.has("noindex");
  const hasFollow = tokens.has("follow");
  const hasNofollow = tokens.has("nofollow");

  if (hasIndex && hasNoindex) return false;
  if (hasFollow && hasNofollow) return false;

  return true;
}

function isArticlePath(path: string): boolean {
  return path.replace(/\/+$/, "").includes("/articles");
}

type JsonLdWebPage = {
  name?: string;
  description?: string;
  url?: string;
};

function parseWebPageJsonLd(jsonLdScripts: string[]): JsonLdWebPage | null {
  for (const raw of jsonLdScripts) {
    try {
      const data = JSON.parse(raw) as JsonLdWebPage & { "@type"?: string };
      if (data["@type"] === "WebPage") return data;
    } catch {
      continue;
    }
  }

  return null;
}

function pushCheck(
  results: TechnicalCheckResult[],
  field: string,
  expected: string,
  actual: string,
  matched: boolean,
): void {
  results.push({
    field,
    expected,
    actual,
    status: matched ? "matched" : "failed",
  });
}

export function compareTechnicalSeo(
  entryPath: string,
  technical: SeoTechnicalMetadata,
  pageTitle: string,
  pageDescription: string,
): TechnicalCheckResult[] {
  const results: TechnicalCheckResult[] = [];
  const pageKind = classifySeoPageKind(entryPath);
  const expectedCanonical = buildExpectedCanonicalUrl(entryPath);

  pushCheck(
    results,
    "html lang",
    "ja",
    technical.htmlLang,
    technical.htmlLang === "ja",
  );

  if (pageKind === "listing") {
    const parsedCount = extractFacilityCount(pageDescription);
    const useFlexibleRobots =
      isUnresolvedArticleTemplate(entryPath) || parsedCount === null;
    const robotsExpectation = useFlexibleRobots
      ? "(valid index/follow directive)"
      : expectedListingRobots(pageDescription);
    pushCheck(
      results,
      "robots",
      robotsExpectation,
      technical.robots,
      useFlexibleRobots
        ? isValidRobotsValue(technical.robots)
        : robotsEquivalent(robotsExpectation, technical.robots),
    );
    pushCheck(
      results,
      "canonical (absent)",
      "(none)",
      technical.canonical || "(none)",
      !technical.canonical,
    );
    pushCheck(
      results,
      "og:title (absent)",
      "(none)",
      technical.ogTitle || "(none)",
      !technical.ogTitle,
    );
    return results;
  }

  const expectedRobots = "index, follow";
  pushCheck(
    results,
    "robots",
    isArticlePath(entryPath) ? "index, follow | noindex, nofollow" : expectedRobots,
    technical.robots,
    isArticlePath(entryPath)
      ? isValidRobotsValue(technical.robots)
      : robotsEquivalent(expectedRobots, technical.robots),
  );

  pushCheck(
    results,
    "canonical",
    expectedCanonical,
    technical.canonical,
    normalizeUrlForCompare(technical.canonical) ===
      normalizeUrlForCompare(expectedCanonical),
  );

  const socialTitle = normalizeTitleForSocial(pageTitle);

  pushCheck(
    results,
    "og:title",
    socialTitle,
    technical.ogTitle,
    technical.ogTitle === socialTitle,
  );

  pushCheck(
    results,
    "og:description",
    pageDescription,
    technical.ogDescription,
    technical.ogDescription === pageDescription,
  );

  const canonicalComparable = normalizeUrlForCompare(
    technical.canonical || expectedCanonical,
  );
  pushCheck(
    results,
    "og:url",
    canonicalComparable,
    normalizeUrlForCompare(technical.ogUrl),
    normalizeUrlForCompare(technical.ogUrl) === canonicalComparable,
  );

  pushCheck(
    results,
    "og:type",
    "website",
    technical.ogType,
    technical.ogType === "website",
  );

  pushCheck(
    results,
    "twitter:card",
    "(present)",
    technical.twitterCard || "(missing)",
    technical.twitterCard.length > 0,
  );

  pushCheck(
    results,
    "twitter:title",
    socialTitle,
    technical.twitterTitle,
    technical.twitterTitle === socialTitle,
  );

  pushCheck(
    results,
    "twitter:description",
    pageDescription,
    technical.twitterDescription,
    technical.twitterDescription === pageDescription,
  );

  const webPageJsonLd = parseWebPageJsonLd(technical.jsonLd);

  pushCheck(
    results,
    "json-ld WebPage",
    "(present)",
    webPageJsonLd ? "(present)" : "(missing)",
    webPageJsonLd !== null,
  );

  pushCheck(
    results,
    "json-ld WebPage.name",
    socialTitle,
    webPageJsonLd?.name ?? "",
    webPageJsonLd?.name === socialTitle,
  );

  pushCheck(
    results,
    "json-ld WebPage.description",
    pageDescription,
    webPageJsonLd?.description ?? "",
    webPageJsonLd?.description === pageDescription,
  );

  pushCheck(
    results,
    "json-ld WebPage.url",
    canonicalComparable,
    normalizeUrlForCompare(webPageJsonLd?.url ?? ""),
    normalizeUrlForCompare(webPageJsonLd?.url ?? "") === canonicalComparable,
  );

  return results;
}

export function logTechnicalResults(
  url: string,
  results: TechnicalCheckResult[],
): void {
  const failures = results.filter((result) => result.status === "failed");

  if (failures.length === 0) {
    console.log(`✅  All technical SEO checks passed — ${url}`);
    return;
  }

  console.log(`\n❌  ${failures.length} technical SEO check(s) failed — ${url}`);
  for (const result of failures) {
    console.log(`   [${result.field}]`);
    console.log(`     expected : ${result.expected}`);
    console.log(`     actual   : ${result.actual || "(missing)"}`);
  }
}
