import type { Page } from "@playwright/test";

import { resolveFullUrl } from "../support/navigation.js";

export class BasePage {
  constructor(protected readonly page: Page) {}

  async goto(url: string) {
    return this.page.goto(resolveFullUrl(url), {
      waitUntil: "domcontentloaded",
    });
  }

  protected async waitForAnySelector(
    selectors: readonly string[],
    timeout = 5_000,
  ): Promise<void> {
    await this.page
      .waitForSelector(selectors.join(", "), { timeout })
      .catch((err: Error) => {
        if (!err.message.includes("Timeout")) throw err;
      });
  }
}
