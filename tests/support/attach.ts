import type { TestInfo } from "@playwright/test";

export async function attachJson(
  testInfo: TestInfo,
  name: string,
  payload: unknown,
): Promise<void> {
  await testInfo.attach(name, {
    contentType: "application/json",
    body: JSON.stringify(payload, null, 2),
  });
}
