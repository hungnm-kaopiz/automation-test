import {
  attachRedirectResult,
  expectFacilityQueryRedirect,
} from "./support/redirect.js";
import {
  buildSearchPath,
  pathToSearchParams,
} from "./support/facility-query.js";
import { loadOutputJson, type OutputEntry } from "./support/load-output-json.js";
import { isRootRakitaPath } from "./support/paths.js";
import { registerJsonSuite } from "./support/data-driven.js";

const SOURCE_FILE = "output.final.json";

const entries = loadOutputJson<OutputEntry>(SOURCE_FILE).filter(
  (entry) =>
    entry.リダイレクト有無?.trim() === "有" &&
    Boolean(entry.path) &&
    isRootRakitaPath(entry.path!),
);

registerJsonSuite({
  suiteName: "Root facility query redirects",
  sourceFile: SOURCE_FILE,
  entries,
  run: async ({ entry, page, testInfo }) => {
    const targetPath = entry.path!;
    const sourcePath = buildSearchPath(pathToSearchParams(targetPath));
    const result = await expectFacilityQueryRedirect(
      page,
      sourcePath,
      targetPath,
    );

    await attachRedirectResult(testInfo, result);
  },
});
