import type { Page, TestInfo } from "@playwright/test";

import { expect, test } from "../fixtures.js";
import { getEntryLabel, type OutputEntry } from "./load-output-json.js";

type JsonSuiteRunContext<T> = {
  entry: T;
  page: Page;
  testInfo: TestInfo;
};

export function registerJsonSuite<T extends OutputEntry>(options: {
  suiteName: string;
  sourceFile: string;
  entries: T[];
  run: (context: JsonSuiteRunContext<T>) => Promise<void>;
}): void {
  const { suiteName, sourceFile, entries, run } = options;

  test.describe(suiteName, () => {
    test(`loads cases from ${sourceFile}`, () => {
      expect(entries.length, `${sourceFile} must contain entries`).toBeGreaterThan(
        0,
      );
    });

    entries.forEach((entry, index) => {
      test(`[${sourceFile}] ${index + 1} ${getEntryLabel(entry)}`, async ({
        page,
      }, testInfo) => {
        await run({ entry, page, testInfo });
      });
    });
  });
}
