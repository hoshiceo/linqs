import { describe, expect, it } from "vitest";
import { DEVICE_BOOKMARKS_KEY, loadDeviceBookmarks, removeDeviceBookmark, toggleDeviceBookmark } from "../src/lib/device-bookmarks";
const id = "33333333-3333-4333-8333-333333333333";
const another = "44444444-4444-4444-8444-444444444444";
function device() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
describe("device bookmarks", () => {
  it("imports legacy marks once and keeps subsequent changes independent", () => {
    const first = device(); const second = device();
    expect(loadDeviceBookmarks(first, [id, id])).toEqual([id]);
    expect(loadDeviceBookmarks(second, [id])).toEqual([id]);
    expect(toggleDeviceBookmark(first, id)).toEqual([]);
    expect(loadDeviceBookmarks(first, [id])).toEqual([]);
    expect(loadDeviceBookmarks(second)).toEqual([id]);
    toggleDeviceBookmark(first, another);
    expect(removeDeviceBookmark(first, another)).toEqual([]);
  });
  it("preserves unreadable saved data and does not silently overwrite it", () => {
    const storage = device();
    for (const value of ["invalid JSON", '["not-a-uuid"]']) {
      storage.setItem(DEVICE_BOOKMARKS_KEY, value);
      expect(() => loadDeviceBookmarks(storage, [id])).toThrow();
      expect(storage.getItem(DEVICE_BOOKMARKS_KEY)).toBe(value);
    }
  });
  it("reports failed writes and preserves the previously persisted IDs", () => {
    const storage = device(); loadDeviceBookmarks(storage, [id]);
    const blocked = { ...storage, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(() => toggleDeviceBookmark(blocked, id)).toThrow();
    expect(loadDeviceBookmarks(storage)).toEqual([id]);
  });
});
