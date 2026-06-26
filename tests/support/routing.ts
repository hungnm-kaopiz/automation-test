import { expect, type Page } from "@playwright/test";

import { gotoPath } from "./navigation.js";
import { getPathname, pathnamesMatch } from "./paths.js";

export async function expectPageOk(page: Page, path: string): Promise<void> {
  const response = await gotoPath(page, path);

  expect(response?.status(), `Expected ${path} to load successfully`).toBe(200);
  expect(
    pathnamesMatch(getPathname(page.url()), path),
    `Expected pathname ${path}, got ${getPathname(page.url())}`,
  ).toBe(true);
}

export async function expectPageNotFound(page: Page, path: string): Promise<void> {
  const response = await gotoPath(page, path);

  expect(response?.status(), `Expected ${path} to return 404`).toBe(404);
}
