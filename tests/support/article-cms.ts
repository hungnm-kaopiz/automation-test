/** CMS-driven article pages under /rakita/articles/ (not the static list). */

export const ARTICLE_CMS_PLACEHOLDER_H1 = "h1タイトル";
export const ARTICLE_CMS_PLACEHOLDER_DESCRIPTION =
  "120文字前後で記事毎に設定";

export function articlePathname(pageUrl: string): string {
  try {
    return new URL(pageUrl).pathname;
  } catch {
    return pageUrl;
  }
}

/** Static article index — fixed SEO copy, exact match OK. */
export function isArticleListPage(pageUrl: string): boolean {
  const path = articlePathname(pageUrl);
  return path === "/rakita/articles" || path === "/rakita/articles/";
}

/** Category, tag, or article-detail — CMS slots stay as `{…}` in output.final.json. */
export function isArticleCmsPage(pageUrl: string): boolean {
  const path = articlePathname(pageUrl);
  if (!path.startsWith("/rakita/articles")) return false;
  return !isArticleListPage(pageUrl);
}

export function isArticleCategoryPage(pageUrl: string): boolean {
  return articlePathname(pageUrl).includes("/rakita/articles/category/");
}

export function isArticleTagPage(pageUrl: string): boolean {
  return articlePathname(pageUrl).includes("/rakita/articles/tag/");
}

/** `/rakita/articles/{slug}/` excluding category/ and tag/ segments. */
export function isArticleDetailPage(pageUrl: string): boolean {
  const path = articlePathname(pageUrl);
  const match = path.match(/^\/rakita\/articles\/([^/]+)\/?$/);
  if (!match) return false;
  const segment = match[1];
  return segment !== "category" && segment !== "tag";
}

/** Visible article-detail fields used to assert Article JSON-LD. */
export type ArticleDetailContext = {
  headline: string;
  author?: {
    name: string;
    websiteUrl?: string;
  };
  supervisor?: {
    name: string;
    bio?: string;
    imageUrl?: string;
    websiteUrl?: string;
  };
};

/** SEO.csv placeholders — per-article CMS copy, not asserted literally. */
export function isArticleCmsPlaceholderValue(
  field: "h1" | "description",
  value: string,
): boolean {
  if (field === "h1") return value === ARTICLE_CMS_PLACEHOLDER_H1;
  if (field === "description") {
    return value === ARTICLE_CMS_PLACEHOLDER_DESCRIPTION;
  }
  return false;
}
