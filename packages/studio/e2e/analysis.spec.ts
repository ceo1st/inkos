import { test, expect } from "@playwright/test";
import { seedAnalysis, E2E_ANALYSIS_ID } from "./fixtures/seed-analysis";

test.beforeAll(async () => {
  await seedAnalysis();
});

test("analysis panel shows issues, emotion arc, and path distribution", async ({ page }) => {
  // 1. Open the film wizard page and wait for the stepper to render.
  await page.goto(`/#/studio/film/${E2E_ANALYSIS_ID}`);
  await expect(page.getByTestId("film-wizard")).toBeVisible({ timeout: 20_000 });

  // 2. Click the validate step button.
  await page.getByTestId("wizard-step-validate").click();

  // 3. The validation panel must be visible and list the seeded ISOLATED_NODE issue.
  await expect(page.getByTestId("validation-panel")).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByTestId("validation-issue-ISOLATED_NODE").first(),
  ).toBeVisible({ timeout: 15_000 });

  // 4. The emotion arc chart must be rendered.
  await expect(page.getByTestId("emotion-arc")).toBeVisible({ timeout: 15_000 });

  // 5. The path distribution panel must be rendered.
  await expect(page.getByTestId("path-distribution")).toBeVisible({ timeout: 15_000 });
});
