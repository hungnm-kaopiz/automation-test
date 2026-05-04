import { APP_BASE_URL } from "./navigation.js";
import {
  type ArticleDetailContext,
  isArticleDetailPage,
} from "./article-cms.js";

export type SeoTechnicalMetadata = {
  htmlLang: string;
  charset: string;
  viewport: string;
  robots: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogUrl: string;
  ogType: string;
  ogImage: string;
  ogSiteName: string;
  ogLocale: string;
  twitterCard: string;
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: string;
  h1Count: number;
  jsonLd: string[];
};

/** Common SEO length guidance (Google typically truncates around these). */
const TITLE_MAX_LENGTH = 60;
const DESCRIPTION_MAX_LENGTH = 160;

/** og:locale format is language_TERRITORY, e.g. ja_JP. */
const OG_LOCALE_PATTERN = /^[a-z]{2}_[A-Z]{2}$/;

/** Valid values for the twitter:card meta per Twitter/X card spec. */
const VALID_TWITTER_CARDS = new Set([
  "summary",
  "summary_large_image",
  "app",
  "player",
]);

/** Social/share image URLs must be absolute (http/https) to be crawlable. */
function isAbsoluteHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

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

type JsonLdPerson = {
  name?: string;
  url?: string;
  description?: string;
  image?: string | { url?: string };
};

type JsonLdArticle = {
  headline?: string;
  url?: string;
  datePublished?: string;
  dateModified?: string;
  image?: string | string[] | { url?: string };
  author?: JsonLdPerson;
  accountablePerson?: JsonLdPerson;
  publisher?: {
    name?: string;
    logo?: string | { url?: string };
  };
};

function findNodeByType(
  node: unknown,
  type: string,
): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNodeByType(child, type);
      if (found) return found;
    }
    return null;
  }

  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    const nodeType = record["@type"];
    if (
      nodeType === type ||
      (Array.isArray(nodeType) && nodeType.includes(type))
    ) {
      return record;
    }
    if ("@graph" in record) {
      return findNodeByType(record["@graph"], type);
    }
  }

  return null;
}

function findJsonLdNodeByType(
  jsonLdScripts: string[],
  type: string,
): Record<string, unknown> | null {
  for (const raw of jsonLdScripts) {
    try {
      const found = findNodeByType(JSON.parse(raw), type);
      if (found) return found;
    } catch {
      continue;
    }
  }

  return null;
}

function parseWebPageJsonLd(jsonLdScripts: string[]): JsonLdWebPage | null {
  const node = findJsonLdNodeByType(jsonLdScripts, "WebPage");
  return node as JsonLdWebPage | null;
}

function parseArticleJsonLd(jsonLdScripts: string[]): JsonLdArticle | null {
  const node = findJsonLdNodeByType(jsonLdScripts, "Article");
  return node as JsonLdArticle | null;
}

function isIso8601Date(value: string): boolean {
  if (!value) return false;
  return !Number.isNaN(Date.parse(value));
}

function jsonLdImageUrl(image: JsonLdArticle["image"]): string {
  if (!image) return "";
  if (typeof image === "string") return image;
  if (Array.isArray(image)) return jsonLdImageUrl(image[0]);
  if (typeof image === "object" && "url" in image) {
    return image.url ?? "";
  }
  return "";
}

function jsonLdPersonImageUrl(
  image: JsonLdPerson["image"] | undefined,
): string {
  if (!image) return "";
  if (typeof image === "string") return image;
  return image.url ?? "";
}

/** True if any @type in the node (or its @graph / array members) matches `type`. */
function jsonLdContainsType(node: unknown, type: string): boolean {
  if (Array.isArray(node)) {
    return node.some((child) => jsonLdContainsType(child, type));
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    const nodeType = record["@type"];
    if (nodeType === type || (Array.isArray(nodeType) && nodeType.includes(type))) {
      return true;
    }
    if ("@graph" in record) return jsonLdContainsType(record["@graph"], type);
  }
  return false;
}

function hasJsonLdType(jsonLdScripts: string[], type: string): boolean {
  for (const raw of jsonLdScripts) {
    try {
      if (jsonLdContainsType(JSON.parse(raw), type)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/** Root `/rakita` has no breadcrumb, so it is exempt from BreadcrumbList. */
function isRakitaTopEntry(entryPath: string): boolean {
  return (entryPath.replace(/\/+$/, "") || "/rakita") === "/rakita";
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

function appendArticleDetailJsonLdChecks(
  results: TechnicalCheckResult[],
  technical: SeoTechnicalMetadata,
  articleDetail: ArticleDetailContext,
  canonicalComparable: string,
): void {
  const articleJsonLd = parseArticleJsonLd(technical.jsonLd);
  const brandName = technical.ogSiteName;

  pushCheck(
    results,
    "json-ld Article",
    "(present)",
    articleJsonLd ? "(present)" : "(missing)",
    articleJsonLd !== null,
  );
  if (!articleJsonLd) return;

  pushCheck(
    results,
    "json-ld Article.headline",
    articleDetail.headline,
    articleJsonLd.headline ?? "",
    articleJsonLd.headline === articleDetail.headline,
  );

  pushCheck(
    results,
    "json-ld Article.url",
    canonicalComparable,
    normalizeUrlForCompare(articleJsonLd.url ?? ""),
    normalizeUrlForCompare(articleJsonLd.url ?? "") === canonicalComparable,
  );

  pushCheck(
    results,
    "json-ld Article.datePublished",
    "(ISO 8601 date)",
    articleJsonLd.datePublished ?? "",
    isIso8601Date(articleJsonLd.datePublished ?? ""),
  );

  pushCheck(
    results,
    "json-ld Article.dateModified",
    "(ISO 8601 date)",
    articleJsonLd.dateModified ?? "",
    isIso8601Date(articleJsonLd.dateModified ?? ""),
  );

  if (
    isIso8601Date(articleJsonLd.datePublished ?? "") &&
    isIso8601Date(articleJsonLd.dateModified ?? "")
  ) {
    const publishedAt = Date.parse(articleJsonLd.datePublished!);
    const revisedAt = Date.parse(articleJsonLd.dateModified!);
    pushCheck(
      results,
      "json-ld Article.dateModified >= datePublished",
      ">= datePublished",
      articleJsonLd.dateModified ?? "",
      revisedAt >= publishedAt,
    );
  }

  const articleImage = jsonLdImageUrl(articleJsonLd.image);
  pushCheck(
    results,
    "json-ld Article.image (absolute url)",
    "(absolute http/https url)",
    articleImage || "(missing)",
    isAbsoluteHttpUrl(articleImage),
  );
  pushCheck(
    results,
    "json-ld Article.image matches og:image",
    normalizeUrlForCompare(technical.ogImage),
    normalizeUrlForCompare(articleImage),
    normalizeUrlForCompare(articleImage) ===
      normalizeUrlForCompare(technical.ogImage),
  );

  if (articleDetail.author) {
    pushCheck(
      results,
      "json-ld Article.author",
      "(present)",
      articleJsonLd.author ? "(present)" : "(missing)",
      articleJsonLd.author !== undefined,
    );
    pushCheck(
      results,
      "json-ld Article.author.name",
      articleDetail.author.name,
      articleJsonLd.author?.name ?? "",
      articleJsonLd.author?.name === articleDetail.author.name,
    );
    if (articleDetail.author.websiteUrl) {
      pushCheck(
        results,
        "json-ld Article.author.url",
        articleDetail.author.websiteUrl,
        articleJsonLd.author?.url ?? "",
        articleJsonLd.author?.url === articleDetail.author.websiteUrl,
      );
    }
  } else {
    pushCheck(
      results,
      "json-ld Article.author",
      "(absent)",
      articleJsonLd.author ? "(present)" : "(absent)",
      articleJsonLd.author === undefined,
    );
  }

  if (articleDetail.supervisor) {
    pushCheck(
      results,
      "json-ld Article.accountablePerson",
      "(present)",
      articleJsonLd.accountablePerson ? "(present)" : "(missing)",
      articleJsonLd.accountablePerson !== undefined,
    );
    pushCheck(
      results,
      "json-ld Article.accountablePerson.name",
      articleDetail.supervisor.name,
      articleJsonLd.accountablePerson?.name ?? "",
      articleJsonLd.accountablePerson?.name === articleDetail.supervisor.name,
    );
    if (articleDetail.supervisor.bio) {
      pushCheck(
        results,
        "json-ld Article.accountablePerson.description",
        articleDetail.supervisor.bio,
        articleJsonLd.accountablePerson?.description ?? "",
        articleJsonLd.accountablePerson?.description ===
          articleDetail.supervisor.bio,
      );
    }
    if (articleDetail.supervisor.websiteUrl) {
      pushCheck(
        results,
        "json-ld Article.accountablePerson.url",
        articleDetail.supervisor.websiteUrl,
        articleJsonLd.accountablePerson?.url ?? "",
        articleJsonLd.accountablePerson?.url ===
          articleDetail.supervisor.websiteUrl,
      );
    }
    if (articleDetail.supervisor.imageUrl) {
      const accountableImage = jsonLdPersonImageUrl(
        articleJsonLd.accountablePerson?.image,
      );
      pushCheck(
        results,
        "json-ld Article.accountablePerson.image (absolute url)",
        "(absolute http/https url)",
        accountableImage || "(missing)",
        isAbsoluteHttpUrl(accountableImage),
      );
    }
  } else {
    pushCheck(
      results,
      "json-ld Article.accountablePerson",
      "(absent)",
      articleJsonLd.accountablePerson ? "(present)" : "(absent)",
      articleJsonLd.accountablePerson === undefined,
    );
  }

  pushCheck(
    results,
    "json-ld Article.publisher",
    "(present)",
    articleJsonLd.publisher ? "(present)" : "(missing)",
    articleJsonLd.publisher !== undefined,
  );
  pushCheck(
    results,
    "json-ld Article.publisher.name",
    brandName,
    articleJsonLd.publisher?.name ?? "",
    articleJsonLd.publisher?.name === brandName,
  );

  const publisherLogo = jsonLdImageUrl(articleJsonLd.publisher?.logo);
  pushCheck(
    results,
    "json-ld Article.publisher.logo (absolute url)",
    "(absolute http/https url)",
    publisherLogo || "(missing)",
    isAbsoluteHttpUrl(publisherLogo),
  );
}

export function compareTechnicalSeo(
  entryPath: string,
  technical: SeoTechnicalMetadata,
  pageTitle: string,
  pageDescription: string,
  articleDetail?: ArticleDetailContext,
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

  pushCheck(
    results,
    "charset",
    "utf-8",
    technical.charset || "(missing)",
    technical.charset.toLowerCase() === "utf-8",
  );

  pushCheck(
    results,
    "viewport (responsive)",
    "width=device-width",
    technical.viewport || "(missing)",
    /width=device-width/i.test(technical.viewport),
  );

  pushCheck(
    results,
    "og:locale",
    "(e.g. ja_JP)",
    technical.ogLocale || "(missing)",
    OG_LOCALE_PATTERN.test(technical.ogLocale),
  );

  pushCheck(
    results,
    "single h1",
    "exactly 1 <h1>",
    String(technical.h1Count),
    technical.h1Count === 1,
  );

  pushCheck(
    results,
    "title length",
    `<= ${TITLE_MAX_LENGTH} chars`,
    `${pageTitle.length} chars`,
    pageTitle.length > 0 && pageTitle.length <= TITLE_MAX_LENGTH,
  );

  pushCheck(
    results,
    "description length",
    `<= ${DESCRIPTION_MAX_LENGTH} chars`,
    `${pageDescription.length} chars`,
    pageDescription.length > 0 && pageDescription.length <= DESCRIPTION_MAX_LENGTH,
  );

  if (!isRakitaTopEntry(entryPath)) {
    pushCheck(
      results,
      "json-ld BreadcrumbList",
      "(present)",
      hasJsonLdType(technical.jsonLd, "BreadcrumbList") ? "(present)" : "(missing)",
      hasJsonLdType(technical.jsonLd, "BreadcrumbList"),
    );
  }

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
      "canonical",
      expectedCanonical,
      technical.canonical || "(missing)",
      Boolean(technical.canonical) &&
        normalizeUrlForCompare(technical.canonical) ===
          normalizeUrlForCompare(expectedCanonical),
    );
    pushCheck(
      results,
      "og:title",
      normalizeTitleForSocial(pageTitle),
      technical.ogTitle || "(missing)",
      technical.ogTitle === normalizeTitleForSocial(pageTitle),
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
    "og:site_name",
    "(present)",
    technical.ogSiteName || "(missing)",
    technical.ogSiteName.length > 0,
  );

  pushCheck(
    results,
    "og:image (absolute url)",
    "(absolute http/https url)",
    technical.ogImage || "(missing)",
    isAbsoluteHttpUrl(technical.ogImage),
  );

  pushCheck(
    results,
    "twitter:card",
    [...VALID_TWITTER_CARDS].join(" | "),
    technical.twitterCard || "(missing)",
    VALID_TWITTER_CARDS.has(technical.twitterCard),
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

  pushCheck(
    results,
    "twitter:image (absolute url)",
    "(absolute http/https url)",
    technical.twitterImage || "(missing)",
    isAbsoluteHttpUrl(technical.twitterImage),
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

  if (isArticleDetailPage(entryPath) && articleDetail) {
    appendArticleDetailJsonLdChecks(
      results,
      technical,
      articleDetail,
      canonicalComparable,
    );
  }

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
