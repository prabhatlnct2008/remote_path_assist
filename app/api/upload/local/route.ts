import { createId } from "@paralleldrive/cuid2";
import { currentUser } from "@/lib/auth/guards";
import {
  checkCanUpload,
  extForType,
  isAllowedContentType,
  isAllowedSize,
  registerImage,
} from "@/lib/images";
import { putLocalObject, storageMode } from "@/lib/storage";

// Local-dev upload path: the file is proxied through the server to disk. In
// production uploads go directly browser→Blob (see /api/upload). This route is
// only active when no BLOB_READ_WRITE_TOKEN is configured.
export async function POST(req: Request) {
  if (storageMode() !== "local") {
    return Response.json({ error: "LOCAL_DISABLED" }, { status: 404 });
  }
  const user = await currentUser();
  if (!user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const form = await req.formData();
  const caseId = String(form.get("caseId") ?? "");
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "NO_FILE" }, { status: 400 });
  }

  const check = await checkCanUpload(user, caseId);
  if (!check.ok) return Response.json({ error: check.code }, { status: 403 });
  if (!isAllowedContentType(file.type)) {
    return Response.json({ error: "BAD_TYPE" }, { status: 400 });
  }
  if (!isAllowedSize(file.size)) {
    return Response.json({ error: "BAD_SIZE" }, { status: 400 });
  }

  const imageId = createId();
  const pathname = `${caseId}/${imageId}.${extForType(file.type)}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { url } = await putLocalObject(pathname, buf);

  const reg = await registerImage({
    caseId,
    filename: file.name,
    blobUrl: url,
    blobPathname: pathname,
    contentType: file.type,
    sizeBytes: file.size,
    uploadedBy: user.id,
  });

  return Response.json({ id: reg.id, url });
}
