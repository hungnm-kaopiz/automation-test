import { expectRedirectTo } from "./support/redirect.js";
import { expectPageNotFound, expectPageOk } from "./support/routing.js";
import { expect, test } from "./fixtures.js";

test.describe("URL parsing and routing", () => {
  test("valid route combinations load successfully", async ({ page }) => {
    await expectPageOk(page, "/rakita/1/2/");
    await expectPageOk(page, "/rakita/27/station/36827/");
    await expectPageOk(page, "/rakita/27/tag/2/");
    await expectPageOk(page, "/rakita/27/developmental/");
  });

  test("returns 404 for invalid route combinations", async ({ page }) => {
    await expectPageNotFound(page, "/rakita/27/2/station/36827/");
  });
});

test.describe("URL normalization redirects", () => {
  test("redirects descending tag ids to ascending order", async ({ page }) => {
    await expectRedirectTo(page, "/rakita/27/tag/5/2/", "/rakita/27/tag/2/5");
  });
});
