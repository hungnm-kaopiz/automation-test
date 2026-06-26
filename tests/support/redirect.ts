import { expect, type Page } from "@playwright/test";

import { attachJson } from "./attach.js";
import {
  collectDocumentResponses,
  gotoPath,
  type DocumentResponse,
} from "./navigation.js";
import { getPathname, normalizePathname, pathnamesMatch } from "./paths.js";

export type RedirectAssertionResult = {
  sourcePath: string;
  targetPath: string;
  redirectStatus: number;
  location: string;
  finalPathname: string;
  finalStatus: number;
};

const REDIRECT_STATUSES = [301, 307, 308] as const;

function findRedirectToTarget(
  responses: DocumentResponse[],
  targetPath: string,
  allowedStatuses: readonly number[] = REDIRECT_STATUSES,
): DocumentResponse | undefined {
  const normalizedTarget = normalizePathname(targetPath);

  return responses.find(
    (response) =>
      allowedStatuses.includes(response.status) &&
      normalizePathname(response.location).includes(normalizedTarget),
  );
}

async function assertRedirectResult(
  page: Page,
  sourcePath: string,
  targetPath: string,
  redirectResponse: DocumentResponse | undefined,
  finalStatus: number | undefined,
): Promise<RedirectAssertionResult> {
  expect(
    redirectResponse,
    `Expected a redirect to ${targetPath} when visiting ${sourcePath}`,
  ).toBeTruthy();
  expect(
    finalStatus,
    `Expected ${sourcePath} to finish on 200`,
  ).toBe(200);
  expect(
    pathnamesMatch(getPathname(page.url()), targetPath),
    `Expected final URL pathname to be ${targetPath}, got ${getPathname(page.url())}`,
  ).toBe(true);

  return {
    sourcePath,
    targetPath,
    redirectStatus: redirectResponse!.status,
    location: redirectResponse!.location,
    finalPathname: getPathname(page.url()),
    finalStatus: finalStatus ?? 0,
  };
}

export async function expectRedirectTo(
  page: Page,
  sourcePath: string,
  targetPath: string,
): Promise<RedirectAssertionResult> {
  const { result: finalResponse, responses } = await collectDocumentResponses(
    page,
    () => gotoPath(page, sourcePath),
  );

  return assertRedirectResult(
    page,
    sourcePath,
    targetPath,
    findRedirectToTarget(responses, targetPath),
    finalResponse?.status(),
  );
}

export async function expectFacilityQueryRedirect(
  page: Page,
  sourcePath: string,
  targetPath: string,
): Promise<RedirectAssertionResult> {
  const { result: finalResponse, responses } = await collectDocumentResponses(
    page,
    () => gotoPath(page, sourcePath),
  );

  return assertRedirectResult(
    page,
    sourcePath,
    targetPath,
    findRedirectToTarget(responses, targetPath),
    finalResponse?.status(),
  );
}

export async function attachRedirectResult(
  testInfo: import("@playwright/test").TestInfo,
  result: RedirectAssertionResult,
): Promise<void> {
  await attachJson(testInfo, "redirect-result", result);
}
