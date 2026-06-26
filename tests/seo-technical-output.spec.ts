import { attachJson } from "./support/attach.js";
import {
  getEntryLabel,
  loadOutputJson,
  type OutputEntry,
} from "./support/load-output-json.js";
import {
  compareTechnicalSeo,
  logTechnicalResults,
} from "./support/seo-technical.js";
import { expect, test } from "./fixtures.js";

const SOURCE_FILE = "output.final.json";
const entries = loadOutputJson<OutputEntry>(SOURCE_FILE).filter((entry) =>
  Boolean(entry.fullpath),
);

entries.forEach((entry, index) => {
  test(`[${SOURCE_FILE}] ${index + 1} ${getEntryLabel(entry)}`, async ({
    rakitaListing,
    page,
  }, testInfo) => {
    const testUrl = entry.fullpath;
    await rakitaListing.open(testUrl);
    const openedUrl = page.url();
    console.log(`🔗  Opened: ${openedUrl}`);

    const entryPath = entry.path ?? entry.fullpath;
    await rakitaListing.waitForTechnicalSeo(entryPath);

    const seo = await rakitaListing.readSeoMetadata();
    const technical = await rakitaListing.readSeoTechnicalMetadata();

    const results = compareTechnicalSeo(
      entryPath,
      technical,
      seo.title,
      seo.description,
    );

    await attachJson(testInfo, "seo-technical-compare", {
      expectedUrl: testUrl,
      openedUrl,
      entryPath,
      technical,
      results,
    });
    logTechnicalResults(openedUrl, results);

    for (const result of results) {
      if (result.status !== "failed") continue;

      expect(
        false,
        `[${result.field}]\n  expected : ${result.expected}\n  actual   : ${result.actual || "(missing)"}`,
      ).toBe(true);
    }
  });
});
