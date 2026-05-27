import { readLocalObject } from "@/lib/storage";

// Serves local-dev blob objects. Mirrors the production model where images live
// at unguessable Vercel Blob URLs (cuid2 pathnames); no per-request auth, same
// as the public-blob-URL approach in ARCHITECTURE §9.4 / §10.9.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const obj = await readLocalObject(path.join("/"));
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(obj.data), {
    headers: {
      "Content-Type": obj.contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
