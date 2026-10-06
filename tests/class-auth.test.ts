import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), signInWithPassword: vi.fn(), signInAnonymously: vi.fn(), signOut: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: mocks }) }));
import { getAccessToken, signInClassAccount, signOutClassAccount } from "../src/lib/supabase-client";

describe("shared class account sessions", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
    mocks.signOut.mockResolvedValue({ error: null });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

  it("requires an existing permanent session and never creates anonymous accounts", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(getAccessToken()).rejects.toThrow("ログインしてください");
    mocks.getSession.mockResolvedValue({ data: { session: { user: { is_anonymous: true }, access_token: "anonymous" } }, error: null });
    await expect(getAccessToken()).rejects.toThrow("ログインしてください");
    expect(mocks.signInAnonymously).not.toHaveBeenCalled();
  });
  it("accepts the account only after the server verifies its class membership", async () => {
    const session = { user: { is_anonymous: false }, access_token: "class-token" };
    mocks.signInWithPassword.mockResolvedValue({ data: { session }, error: null });
    mocks.getSession.mockResolvedValue({ data: { session }, error: null });
    const fetch = vi.fn().mockResolvedValue(Response.json({ displayName: "クラス共通" }));
    vi.stubGlobal("fetch", fetch);
    await signInClassAccount(" class@example.com ", "test-password");
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "class@example.com", password: "test-password" });
    expect(fetch).toHaveBeenCalledWith("/api/account", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer class-token" }) }));
  });
  it("clears only this device's session when the signed-in account is not permitted", async () => {
    const session = { user: { is_anonymous: false }, access_token: "other-token" };
    mocks.signInWithPassword.mockResolvedValue({ data: { session }, error: null });
    mocks.getSession.mockResolvedValue({ data: { session }, error: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "このクラスの共通アカウントでログインしてください。" }, { status: 403 })));
    await expect(signInClassAccount("other@example.com", "test-password")).rejects.toThrow("共通アカウント");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("logs out this device without logging out the rest of the class", async () => {
    await signOutClassAccount();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
