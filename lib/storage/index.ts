import { del } from "@vercel/blob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * Storage abstraction. In production (BLOB_READ_WRITE_TOKEN set) images go
 * directly browser→Vercel Blob; the server only signs tokens and deletes.
 * Without a token (local dev) we fall back to a proxied disk store so the full
 * flow is exercisable without external credentials.
 */
export type StorageMode = "blob" | "local";

export function storageMode(): StorageMode {
  return env.BLOB_READ_WRITE_TOKEN ? "blob" : "local";
}

const LOCAL_DIR = path.join(process.cwd(), ".blob-store");

const EXT_CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};

/** Rejects path traversal; pathnames are server-generated but validate anyway. */
function safeLocalPath(pathname: string): string {
  const full = path.normalize(path.join(LOCAL_DIR, pathname));
  if (!full.startsWith(LOCAL_DIR + path.sep)) {
    throw new Error("Invalid storage pathname");
  }
  return full;
}

export async function putLocalObject(
  pathname: string,
  data: Buffer,
): Promise<{ url: string; pathname: string }> {
  const full = safeLocalPath(pathname);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  return { url: `/api/files/${pathname}`, pathname };
}

export async function readLocalObject(
  pathname: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const data = await fs.readFile(safeLocalPath(pathname));
    const ext = path.extname(pathname).slice(1).toLowerCase();
    return { data, contentType: EXT_CONTENT_TYPE[ext] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

/** Deletes a stored object. Blob mode deletes by URL; local mode by pathname. */
export async function deleteObject(opts: { url: string; pathname: string }): Promise<void> {
  if (storageMode() === "blob") {
    await del(opts.url, { token: env.BLOB_READ_WRITE_TOKEN });
    return;
  }
  try {
    await fs.unlink(safeLocalPath(opts.pathname));
  } catch {
    // already gone — fine
  }
}
