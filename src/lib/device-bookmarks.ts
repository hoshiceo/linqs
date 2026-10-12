import { z } from "zod";

export const DEVICE_BOOKMARKS_KEY = "linqs.bookmarks.v1";
type BookmarkStorage = Pick<Storage, "getItem" | "setItem">;
const idsSchema = z.array(z.uuid());

export function loadDeviceBookmarks(storage: BookmarkStorage, legacyIds: string[] = []) {
  const saved = storage.getItem(DEVICE_BOOKMARKS_KEY);
  const ids = [...new Set(idsSchema.parse(saved === null ? legacyIds : JSON.parse(saved)))];
  if (saved === null) storage.setItem(DEVICE_BOOKMARKS_KEY, JSON.stringify(ids));
  return ids;
}

export function toggleDeviceBookmark(storage: BookmarkStorage, id: string) {
  const ids = loadDeviceBookmarks(storage);
  const next = ids.includes(id) ? ids.filter(value => value !== id) : [...ids, z.uuid().parse(id)];
  storage.setItem(DEVICE_BOOKMARKS_KEY, JSON.stringify(next));
  return next;
}

export function removeDeviceBookmark(storage: BookmarkStorage, id: string) {
  const next = loadDeviceBookmarks(storage).filter(value => value !== id);
  storage.setItem(DEVICE_BOOKMARKS_KEY, JSON.stringify(next));
  return next;
}
