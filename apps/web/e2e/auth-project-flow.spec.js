import { test, expect } from "@playwright/test";

test("register, restore session, create project, sign out and sign in", async ({ page }) => {
  const unique = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `${unique}@example.test`;
  const password = "BuildSphere-E2E-Strong-Password-2026";
  const organization = `E2E Construction ${unique}`;
  const projectName = `E2E Riverside Tower ${unique}`;

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to BuildSphere" })).toBeVisible();

  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("BuildSphere E2E Owner");
  await page.getByLabel("Organization name").fill(organization);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create organization" }).click();

  await expect(page.getByRole("heading", { name: "Good to see you, BuildSphere." })).toBeVisible();
  await expect(page.getByText("Your portfolio starts here")).toBeVisible();

  // Exercise refresh-cookie rotation and session restoration in a real browser.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Good to see you, BuildSphere." })).toBeVisible();

  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project code").fill("E2E-001");
  await page.getByLabel("Project name").fill(projectName);
  await page.getByLabel("Client").fill("E2E Client");
  await page.getByLabel("Location").fill("Kolkata, India");
  await page.getByLabel("Budget").fill("1250000");
  await page.getByLabel("Currency").fill("INR");
  await page.getByRole("button", { name: "Create project", exact: true }).click();

  const projectCard = page.locator(".project-card").filter({ hasText: projectName });
  await expect(projectCard).toBeVisible();
  await expect(projectCard).toContainText("E2E-001");
  await expect(projectCard).toContainText("E2E Client");
  await expect(page.locator(".metric-card").first()).toContainText("1");

  // Confirm the persisted portfolio is restored after a full page navigation.
  await page.reload();
  await expect(page.locator(".project-card").filter({ hasText: projectName })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to BuildSphere" })).toBeVisible();

  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("heading", { name: "Good to see you, BuildSphere." })).toBeVisible();
  await expect(page.locator(".project-card").filter({ hasText: projectName })).toBeVisible();
});
