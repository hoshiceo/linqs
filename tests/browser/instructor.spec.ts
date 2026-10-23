import { expect, test, type Page } from "@playwright/test";
import { mockClassApi } from "./class-api";

async function start(page: Page) {
  await mockClassApi(page, { answerText: "IF関数は条件によって結果を切り替えます。" });
  await page.goto("/");
  await page.getByLabel("メールアドレス", { exact: true }).fill("class@example.com");
  await page.getByLabel("パスワード", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByRole("textbox", { name: "質問を入力" }).fill("IF関数の使い方を教えて");
  await page.getByRole("button", { name: "質問を送信", exact: true }).click();
  await expect(page.locator(".markdown")).toContainText("IF関数");
}

async function openInbox(page: Page) {
  const menu = page.getByRole("button", { name: "メニューを開く" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "講師への質問", exact: true }).click();
}

test("send a question from an AI answer, then read its receipt and instructor reply", async ({ page }) => {
  await start(page);
  let submitted = 0;
  page.on("request", request => { if (request.url().endsWith("/api/instructor-questions") && request.method() === "POST") submitted++; });
  await page.getByRole("button", { name: "講師に質問", exact: true }).click();
  const card = page.getByRole("region", { name: "この回答について講師に質問" });
  await expect(card).toContainText("質問と返信はクラス全員で共有されます");
  const submit = card.getByRole("button", { name: "この内容で講師に質問する" });
  await expect(submit).toBeDisabled();
  await card.getByText("講師に共有する質問とAIの回答", { exact: true }).click();
  await expect(card).toContainText("IF関数の使い方を教えて");
  await card.getByLabel("講師に確認したいこと").fill("条件が2つある場合の具体例を教えてください。");
  await card.getByText("講師に共有する質問とAIの回答", { exact: true }).click();
  await card.evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: `test-results/instructor-form-${test.info().project.name}.png`, fullPage: true, scale: "css" });
  await submit.click();
  await expect(card.getByRole("status")).toContainText("講師への質問を受け付けました");
  expect(submitted).toBe(1);
  await card.getByRole("button", { name: "受付状況・返信を確認" }).click();
  await expect(page.getByRole("heading", { name: "講師への質問", exact: true })).toBeVisible();
  await expect(page.locator(".instructor-question")).toHaveCount(1);
  await expect(page.locator(".instructor-question")).toContainText("条件が2つある場合の具体例");
  await expect(page.locator(".instructor-status")).toHaveText("受付済み");
  // Supply a reply only at the test network boundary, never through the student API.
  await page.route("**/api/instructor-questions", route => route.fulfill({ json: { questions: [{ id: "receipt", conversation_title: "IF関数の使い方を教えて", course_id: null, original_question: "IF関数の使い方を教えて", ai_answer: "IF関数は条件によって結果を切り替えます。", question: "条件が2つある場合の具体例を教えてください。", reply: "AND関数を組み合わせてみましょう。", created_at: new Date().toISOString(), replied_at: new Date().toISOString() }] } }));
  await page.getByRole("button", { name: "受付状況・返信を更新" }).click();
  await expect(page.locator(".instructor-status")).toHaveText("返信あり");
  await expect(page.locator(".instructor-reply")).toContainText("AND関数");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/instructor-reply-${test.info().project.name}.png`, fullPage: true, scale: "css" });
});

test("failed submissions preserve the draft and can be retried without duplicate requests", async ({ page }) => {
  await start(page);
  let fail = true;
  await page.route("**/api/instructor-questions", async route => {
    if (!fail || route.request().method() !== "POST") return route.fallback();
    return route.fulfill({ status: 503, json: { error: "質問を受け付けられませんでした。" } });
  });
  await page.getByRole("button", { name: "講師に質問", exact: true }).click();
  const draft = page.getByLabel("講師に確認したいこと");
  await draft.fill("この条件式の意味がわかりません。");
  await page.getByRole("button", { name: "この内容で講師に質問する" }).click();
  await expect(page.locator(".instructor-card").getByRole("alert")).toContainText("質問を受け付けられませんでした");
  await expect(draft).toHaveValue("この条件式の意味がわかりません。");
  fail = false;
  await page.getByRole("button", { name: "この内容で講師に質問する" }).click();
  await expect(page.locator(".instructor-card")).toContainText("講師への質問を受け付けました");
  await openInbox(page);
  await expect(page.locator(".instructor-question")).toHaveCount(1);
});

test("the inbox explains how to ask and shows load failures with a retry", async ({ page }) => {
  await start(page);
  await openInbox(page);
  await expect(page.getByRole("heading", { name: "講師への質問はまだありません" })).toBeVisible();
  await page.route("**/api/instructor-questions", route => route.fulfill({ status: 503, json: { error: "講師への質問を読み込めませんでした。" } }));
  await page.getByRole("button", { name: "受付状況・返信を更新" }).click();
  await expect(page.locator(".instructor-library").getByRole("alert")).toContainText("読み込めませんでした");
  await expect(page.getByRole("heading", { name: "講師への質問はまだありません" })).toHaveCount(0);
});
