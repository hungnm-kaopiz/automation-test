import { expect } from "@playwright/test";

import { classifySeoPageKind } from "../support/seo-technical.js";
import { BasePage } from "./base.page.js";

export type SeoMetadata = {
  title: string;
  description: string;
  h1: string;
  breadcrumb: string;
  breadcrumbSegments: string[];
};

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

const LISTING_H1_SELECTOR = '[data-testid="facility-result-location"]';
/** Client-rendered after data load; wait for non-empty content, not merely attached. */
const META_DESCRIPTION = 'meta[name="description"]';
const NEXT_RUNTIME_ERROR = "[data-nextjs-dialog]";

const NOT_FOUND_TITLE = /404|not\s*found|ページが見つかりません/i;
const PAGE_READY_TIMEOUT = 30_000;

function resolvePathname(url: string): string {
  const path = /^https?:\/\//i.test(url)
    ? new URL(url).pathname
    : url.startsWith("/")
      ? url
      : `/${url}`;
  return path.replace(/\/+$/, "") || "/";
}

const RAKITA_LANDING_TOP_PATHS = new Set([
  "/rakita",
  "/rakita/keizoku",
  "/rakita/keizoku/type_a",
  "/rakita/keizoku/type_b",
  "/rakita/ikou",
]);

/** Scope landing tops have no listing H1 (no facility-result-location, no page h1). */
export function isRakitaLandingTopPage(url: string): boolean {
  return RAKITA_LANDING_TOP_PATHS.has(resolvePathname(url));
}

/** Root `/rakita/` also lacks breadcrumb metadata used on listing pages. */
export function isRakitaTopPage(url: string): boolean {
  return resolvePathname(url) === "/rakita";
}

export class RakitaListingPage extends BasePage {
  private lastOpenedUrl = "";

  async open(url: string): Promise<void> {
    this.lastOpenedUrl = url;
    const response = await this.goto(url);
    expect(response, `No document response for ${url}`).toBeTruthy();
    expect(
      response!.status(),
      `Document response for ${url} should succeed`,
    ).toBeLessThan(400);

    await expect(
      this.page.locator(NEXT_RUNTIME_ERROR),
      "Next.js runtime error (often API fetch failed — ensure backend is up)",
    ).not.toBeVisible({ timeout: 5_000 });

    const meta = this.page.locator(META_DESCRIPTION);
    try {
      await expect(meta).toHaveAttribute("content", /.+/s, {
        timeout: PAGE_READY_TIMEOUT,
      });
    } catch {
      if (!isRakitaLandingTopPage(url)) {
        await expect(this.page.locator(LISTING_H1_SELECTOR)).toBeVisible({
          timeout: 10_000,
        });
      }
      await expect(meta).toHaveAttribute("content", /.+/s, {
        timeout: 15_000,
      });
    }

    await expect(this.page).not.toHaveTitle(NOT_FOUND_TITLE);
  }

  async readSeoMetadata(): Promise<SeoMetadata> {
    const skipH1 = isRakitaLandingTopPage(this.lastOpenedUrl);

    return this.page.evaluate(
      ({ listingH1Selector, skipPageH1 }) => {
        const text = (selector: string) =>
          document.querySelector(selector)?.textContent?.trim() ?? "";

        const attr = (selector: string, name: string) =>
          document.querySelector(selector)?.getAttribute(name) ?? "";

        const h1 = skipPageH1
          ? ""
          : text(listingH1Selector) || text("h1");

        const firstBreadcrumbList = document.querySelector(
          '[data-testid="breadcrum-list"]',
        );
        const breadcrumbSegments = Array.from(
          firstBreadcrumbList?.querySelectorAll(
            '[data-slot="breadcrumb-link"], [data-slot="breadcrumb-page"]',
          ) ?? [],
        )
          .map((el) => el.textContent ?? "")
          .filter((v) => v.trim().length > 0);

        return {
          title: document.title,
          description: attr('meta[name="description"]', "content"),
          h1,
          breadcrumb: breadcrumbSegments.join(" > "),
          breadcrumbSegments,
        };
      },
      { listingH1Selector: LISTING_H1_SELECTOR, skipPageH1: skipH1 },
    );
  }

  async waitForTechnicalSeo(entryPath: string): Promise<void> {
    if (classifySeoPageKind(entryPath) !== "full") return;

    await this.page.waitForFunction(
      () => {
        const canonical = document.querySelector('link[rel="canonical"]');
        const ogTitle = document.querySelector('meta[property="og:title"]');
        return Boolean(
          canonical?.getAttribute("href") && ogTitle?.getAttribute("content"),
        );
      },
      { timeout: 15_000 },
    );

    try {
      await this.page.waitForFunction(
        () =>
          document.querySelectorAll('script[type="application/ld+json"]').length >
          0,
        { timeout: 10_000 },
      );
    } catch {
      // JSON-LD may stream in after shell; compare step reports if still missing.
    }
  }

  async readSeoTechnicalMetadata(): Promise<SeoTechnicalMetadata> {
    return this.page.evaluate(() => {
      const attr = (selector: string, name: string) =>
        document.querySelector(selector)?.getAttribute(name) ?? "";

      const metaContent = (name: string) =>
        attr(`meta[name="${name}"]`, "content");

      const propertyContent = (property: string) =>
        attr(`meta[property="${property}"]`, "content");

      const jsonLd = Array.from(
        document.querySelectorAll('script[type="application/ld+json"]'),
      )
        .map((script) => script.textContent?.trim() ?? "")
        .filter((value) => value.length > 0);

      return {
        htmlLang: document.documentElement.lang ?? "",
        robots: metaContent("robots"),
        canonical: attr('link[rel="canonical"]', "href"),
        ogTitle: propertyContent("og:title"),
        ogDescription: propertyContent("og:description"),
        ogUrl: propertyContent("og:url"),
        ogType: propertyContent("og:type"),
        ogImage: propertyContent("og:image"),
        twitterCard: metaContent("twitter:card"),
        twitterTitle: metaContent("twitter:title"),
        twitterDescription: metaContent("twitter:description"),
        jsonLd,
      };
    });
  }
}
