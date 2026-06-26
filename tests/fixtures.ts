import { test as base, expect } from "@playwright/test";

import { RakitaListingPage } from "./pages/rakita-listing.page.js";
import { setupBlockedResources } from "./support/navigation.js";

type RakitaFixtures = {
  rakitaListing: RakitaListingPage;
};

export const test = base.extend<RakitaFixtures>({
  page: async ({ page }, use) => {
    await setupBlockedResources(page);
    await use(page);
  },
  rakitaListing: async ({ page }, use) => {
    await use(new RakitaListingPage(page));
  },
});

export { expect };
