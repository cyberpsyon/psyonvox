import { openDB, type DBSchema, type IDBPDatabase } from "idb";

// Schema is versioned from day one so future features can migrate without
// corrupting existing users' saved state. Bump DB_VERSION + add an upgrade
// branch; never mutate an existing store's shape in place.
const DB_NAME = "psyonvox";
const DB_VERSION = 1;

export type FileMeta = {
  fileId: string; // name + size + content hash — survives renames sensibly
  name: string;
  size: number;
  hash: string;
  sentenceCount: number;
  lastIndex: number;
  updatedAt: number;
};

export type Bookmark = {
  id?: number;
  fileId: string;
  index: number;
  label: string;
  createdAt: number;
};

interface PsyonVoxDB extends DBSchema {
  files: { key: string; value: FileMeta };
  bookmarks: {
    key: number;
    value: Bookmark;
    indexes: { byFile: string };
  };
}

let dbPromise: Promise<IDBPDatabase<PsyonVoxDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<PsyonVoxDB>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          database.createObjectStore("files", { keyPath: "fileId" });
          const bm = database.createObjectStore("bookmarks", {
            keyPath: "id",
            autoIncrement: true,
          });
          bm.createIndex("byFile", "fileId");
        }
      },
    });
  }
  return dbPromise;
}

/** Stable id from name + size + SHA-256 content hash (first 12 hex chars). */
export async function fileIdentity(
  file: File,
): Promise<{ fileId: string; hash: string }> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hash = [...new Uint8Array(digest)]
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { fileId: `${file.name}:${file.size}:${hash}`, hash };
}

export async function getProgress(fileId: string): Promise<FileMeta | undefined> {
  return (await db()).get("files", fileId);
}

export async function saveProgress(meta: FileMeta): Promise<void> {
  await (await db()).put("files", { ...meta, updatedAt: Date.now() });
}

export async function recentFiles(limit = 8): Promise<FileMeta[]> {
  const all = await (await db()).getAll("files");
  return all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

export async function listBookmarks(fileId: string): Promise<Bookmark[]> {
  const all = await (await db()).getAllFromIndex("bookmarks", "byFile", fileId);
  return all.sort((a, b) => a.index - b.index);
}

export async function addBookmark(bm: Bookmark): Promise<void> {
  await (await db()).add("bookmarks", bm);
}

export async function removeBookmark(id: number): Promise<void> {
  await (await db()).delete("bookmarks", id);
}
