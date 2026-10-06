import { expect, test, type Page } from "@playwright/test";

async function navigate(page: Page, label: string) {
  const menu = page.getByRole("button", { name: "メニューを開く" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: new RegExp(`^${label}(?:\\s+\\d+)?$`) }).click();
}

async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "体験モードを開く", exact: true }).click();
}

test("a student can ask, save, find, reopen and delete a question", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await openDemo(page);
  await expect(page.getByText("体験モード", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /セルA1に文字/ }).click();
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toHaveValue("Excel VBAでセルA1に文字を入力する方法を教えて");
  await page.getByRole("button", { name: "質問を送信" }).click();
  await expect(page.locator(".markdown")).toContainText("セルに文字を入力");
  await expect(page.locator(".markdown pre code")).toContainText("Option Explicit");
  await page.getByRole("button", { name: "この質問を保存" }).click();
  await navigate(page, "保存した質問");
  await expect(page.locator(".history-card")).toHaveCount(1);
  await page.getByRole("textbox", { name: "質問を検索" }).fill("A1");
  await page.locator(".history-open").click();
  await expect(page.locator(".markdown")).toContainText("セルに文字を入力");
  await page.reload();
  await page.getByRole("button", { name: "体験モードを開く", exact: true }).click();
  await navigate(page, "質問の履歴");
  await expect(page.locator(".history-card")).toHaveCount(1);
  await page.getByRole("button", { name: "この質問を削除" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.locator(".history-card")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("hint mode, preferences and Japanese composition behave correctly", async ({ page }) => {
  await openDemo(page);
  await expect(page.getByText("体験モード", { exact: true })).toBeVisible();
  const menu = page.getByRole("button", { name: "メニューを開く" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".profile").click();
  await page.getByRole("combobox", { name: "学習経験", exact: true }).selectOption("実務に応用");
  await page.getByRole("button", { name: /まずはヒント/ }).click();
  await page.getByRole("button", { name: "設定を完了" }).click();
  const close = page.getByRole("button", { name: "メニューを閉じる" }).last();
  if (await close.isVisible()) await close.click();
  await page.getByRole("button", { name: /セルA1に文字/ }).click();
  const input = page.getByRole("textbox", { name: "質問を入力" });
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(page.locator(".markdown")).toHaveCount(0);
  await input.press("Enter");
  await expect(page.locator(".markdown")).toContainText("まずはヒント");
  await expect(page.locator(".markdown")).not.toContainText("セルに文字を入力");
  await page.reload();
  await page.getByRole("button", { name: "体験モードを開く", exact: true }).click();
  const open = page.getByRole("button", { name: "メニューを開く" });
  if (await open.isVisible()) await open.click();
  await expect(page.locator(".profile")).toContainText("実務に応用");
});

test("layout stays inside the viewport and dialogs support keyboard dismissal", async ({ page }) => {
  await openDemo(page);
  await expect(page.getByText("体験モード", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator(".chat-scroll").evaluate(element => element.scrollTop)).toBe(0);
  await page.locator(".question-tip").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.screenshot({ path: `test-results/welcome-${test.info().project.name}.png`, fullPage: true });
});

test("shows the class login form without pretending an unconfigured account exists", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "クラスにログイン" })).toBeVisible();
  await page.getByLabel("メールアドレス", { exact: true }).fill("class@example.com");
  await page.getByLabel("パスワード", { exact: true }).fill("test-password");
  await expect(page.getByRole("button", { name: "ログイン", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "パスワードを表示", exact: true }).click();
  await expect(page.getByLabel("パスワード", { exact: true })).toHaveAttribute("type", "text");
  await expect(page.getByText("共通アカウントの接続設定がまだ完了していません。設定完了後にログインできます。", { exact: true })).toBeVisible();
});
