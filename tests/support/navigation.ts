import type { Page, Response } from "@playwright/test";

export type DocumentResponse = {
  url: string;
  status: number;
  location: string;
};

const BLOCKED_RESOURCE_TYPES = new Set([
  "image",
  "media",
  "font",
  "stylesheet",
]);

export async function setupBlockedResources(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    if (BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())) {
      return route.abort();
    }

    return route.continue();
  });
}

export const APP_BASE_URL =
  process.env["APP_BASE_URL"] ?? "http://localhost:3000";

export function resolveFullUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return new URL(path, APP_BASE_URL).href;
}

export async function gotoPath(page: Page, path: string) {
  const url = resolveFullUrl(path);
  return page.goto(url, { waitUntil: "domcontentloaded" });
}

export async function collectDocumentResponses<T>(
  page: Page,
  action: () => Promise<T>,
): Promise<{ result: T; responses: DocumentResponse[] }> {
  const responses: DocumentResponse[] = [];

  const onResponse = (response: Response) => {
    if (response.request().resourceType() !== "document") {
      return;
    }

    responses.push({
      url: response.url(),
      status: response.status(),
      location: response.headers().location ?? "",
    });
  };

  page.on("response", onResponse);

  try {
    const result = await action();
    return { result, responses };
  } finally {
    page.off("response", onResponse);
  }
}
