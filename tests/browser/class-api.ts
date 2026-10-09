import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import type { Conversation } from "../../src/lib/types";

// Network fixtures only: production code always requires the real class account.
export async function mockClassApi(page: Page, { configured = true, answerSuffix = "" }: { configured?: boolean; answerSuffix?: string } = {}) {
  const id = "33333333-3333-4333-8333-333333333333";
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { id, aud: "authenticated", role: "authenticated", email: "class@example.com", is_anonymous: false, app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: new Date().toISOString() };
  const encode = (data: object) => Buffer.from(JSON.stringify(data)).toString("base64url");
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, role: "authenticated", exp: expires })}.test-signature`;
  let conversations: Conversation[] = [];
  const json = (route: Route, body: object, status = 200) => route.fulfill({ status, json: body });
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

  await page.route("https://linqs-test.supabase.co/auth/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204, headers: cors });
    if (url.pathname.endsWith("/user")) return route.fulfill({ headers: cors, json: user });
    if (url.pathname.endsWith("/token")) {
      const body = request.postDataJSON();
      if (url.searchParams.get("grant_type") !== "refresh_token" && (body.email !== "class@example.com" || body.password !== "test-password")) {
        return route.fulfill({ status: 400, headers: cors, json: { code: "invalid_credentials", msg: "Invalid login credentials" } });
      }
      return route.fulfill({ headers: cors, json: { access_token: token, token_type: "bearer", expires_in: 3600, expires_at: expires, refresh_token: "test-refresh-token", user } });
    }
    return route.fulfill({ status: 500, headers: cors, json: { error: "Unexpected test auth request" } });
  });

  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === "/api/config") return json(route, { mode: configured ? "live" : "incomplete", authReady: configured });
    if (!configured || request.headers().authorization !== `Bearer ${token}`) return json(route, { error: "ログインしてください。" }, 401);
    if (url.pathname === "/api/account") return json(route, { displayName: "クラス共通" });
    if (url.pathname === "/api/conversations") {
      if (method === "GET") return json(route, { conversations });
      if (method === "DELETE") {
        conversations = conversations.filter(c => c.id !== url.searchParams.get("id"));
        return json(route, { ok: true });
      }
      if (method === "PATCH") {
        const body = request.postDataJSON();
        conversations = conversations.map(c => c.id === body.id ? { ...c, bookmarked: body.bookmarked } : c);
        return json(route, { ok: true });
      }
    }
    if (url.pathname === "/api/chat" && method === "POST") {
      const body = request.postDataJSON();
      const now = new Date().toISOString();
      const answer = (body.mode === "hint"
        ? "### まずはヒント\n対象のシートとセルを指定する方法を考えてみましょう。"
        : "### セルに文字を入力\n```vba\nOption Explicit\nSub Greeting()\n    ThisWorkbook.Worksheets(1).Range(\"A1\").Value = \"こんにちは\"\nEnd Sub\n```") + answerSuffix;
      const previous = conversations.find(c => c.id === body.conversationId);
      const conversation: Conversation = { id: previous?.id || randomUUID(), title: previous?.title || body.message, subject: "すべて", bookmarked: previous?.bookmarked || false, created_at: previous?.created_at || now, updated_at: now, messages: [...(previous?.messages || []), { id: randomUUID(), role: "user", content: body.message, created_at: now }, { id: randomUUID(), role: "assistant", content: answer, created_at: now }] };
      conversations = [conversation, ...conversations.filter(c => c.id !== conversation.id)];
      return json(route, { answer, conversationId: conversation.id, saved: true });
    }
    return json(route, { error: "Unexpected test API request" }, 500);
  });
}
