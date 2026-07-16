import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { gotoPath } from "./support/navigation.js";

const SOURCE_FILE = "sitemap-urls.json";

const NOT_FOUND_TEXT =
  "お探しのページは存在しないか、移動された可能性があります。URLをご確認いただくか、トップページへお戻りください。";

const sitemapPath = path.resolve(import.meta.dirname, "..", SOURCE_FILE);
const sitemapUrls = JSON.parse(fs.readFileSync(sitemapPath, "utf8")) as Record<
  string,
  string[]
>;

for (const [group, urls] of Object.entries(sitemapUrls)) {
  test.describe(`sitemap: ${group}`, () => {
    for (const url of urls) {
      test(url, async ({ page }) => {
        const response = await gotoPath(page, url);
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts.ready);

        expect(response?.status(), `HTTP status for ${url}`).toBeLessThan(400);

        await expect(
          page.getByText(NOT_FOUND_TEXT),
          `Page renders not-found message: ${url}`,
        ).toHaveCount(0);

        if (group === "facility-list") {
          // Older builds (e.g. dev) don't have the testid yet; fall back to the "NNN件" text.
          let resultCount = page.getByTestId("facility-result-count");
          try {
            await resultCount.waitFor({ state: "attached", timeout: 15_000 });
          } catch {
            resultCount = page.getByText(/^[\d,]+件$/).first();
            await resultCount.waitFor({ state: "attached", timeout: 5_000 });
          }
          const text = (await resultCount.innerText()).trim();
          const count = Number.parseInt(text.replace(/[^0-9]/g, ""), 10);

          test.info().annotations.push({
            type: "facility-result-count",
            description: `${count} (${url})`,
          });
          console.log(`[facility-result-count] ${count} — ${url}`);

          await page.evaluate(async () => {
            const scrollStep = window.innerHeight;
            while (
              window.scrollY + window.innerHeight <
              document.body.scrollHeight
            ) {
              window.scrollBy(0, scrollStep);
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
            window.scrollTo(0, 0);
          });
          await page.waitForLoadState("networkidle");

          await page.evaluate((currentUrl) => {
            const addressBar = document.createElement("div");
            addressBar.textContent = currentUrl;
            addressBar.style.cssText = [
              "position:fixed",
              "top:0",
              "left:0",
              "right:0",
              "z-index:2147483647",
              "background:#f1f3f4",
              "color:#202124",
              "font:14px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif",
              "padding:8px 12px",
              "border-bottom:1px solid #dadce0",
              "white-space:nowrap",
              "overflow:hidden",
              "text-overflow:ellipsis",
            ].join(";");
            document.body.prepend(addressBar);
            document.body.style.marginTop = `${addressBar.offsetHeight}px`;
          }, page.url());

          const screenshotName = `${page.url().replace(/[^a-zA-Z0-9]+/g, "_")}.png`;
          await test.info().attach(page.url(), {
            body: await page.screenshot({ fullPage: true }),
            contentType: "image/png",
          });
          await page.screenshot({
            fullPage: true,
            path: path.resolve(
              import.meta.dirname,
              "..",
              "screenshots",
              screenshotName,
            ),
          });

          expect(
            count,
            `Facility result count "${text}" on ${url}`,
          ).toBeGreaterThan(0);
        }
      });
    }
  });
}
