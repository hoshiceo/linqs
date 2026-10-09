import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../src/lib/server";
import { GET } from "../src/app/api/config/route";

const keys = ["GEMINI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "CLASS_ACCOUNT_USER_ID"] as const;
afterEach(() => vi.unstubAllEnvs());

describe("class account configuration", () => {
  it.each([
    { values: ["", "", "", ""], expected: { mode: "incomplete", authReady: false } },
    { values: ["test-key", "", "", ""], expected: { mode: "incomplete", authReady: false } },
    { values: ["", "https://example.supabase.co", "test-key", "class-id"], expected: { mode: "incomplete", authReady: true } },
    { values: ["test-key", "https://example.supabase.co", "test-key", "class-id"], expected: { mode: "live", authReady: true } },
  ])("reports $expected with the supplied connections", async ({ values, expected }) => {
    keys.forEach((key, index) => vi.stubEnv(key, values[index]));
    expect(getConfig()).toEqual(expected);
    const response = GET();
    expect(await response.json()).toEqual(expected);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
