import { head } from "@vercel/blob";
import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";
import { currentUser } from "@/lib/auth/guards";
import { IMAGE_CONTENT_TYPES, IMAGE_MAX_BYTES } from "@/lib/constants";
import { checkCanUpload, registerImage } from "@/lib/images";
import { env } from "@/lib/env";

// Production upload: the browser uploads directly to Vercel Blob; this route
// only (1) signs a scoped token after authorizing the case, and (2) records
// the image when Blob calls back on completion (ARCHITECTURE §6.2, §13.1).
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as HandleUploadBody;
  const user = await currentUser();

  try {
    const result = await handleUpload({
      body,
      request: req,
      token: env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        if (!user) throw new Error("UNAUTHENTICATED");
        const { caseId } = JSON.parse(clientPayload ?? "{}") as { caseId?: string };
        if (!caseId) throw new Error("BAD_INPUT");
        const check = await checkCanUpload(user, caseId);
        if (!check.ok) throw new Error(check.code);
        return {
          allowedContentTypes: [...IMAGE_CONTENT_TYPES],
          maximumSizeInBytes: IMAGE_MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ caseId, uploadedBy: user.id }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const { caseId, uploadedBy } = JSON.parse(tokenPayload ?? "{}") as {
          caseId: string;
          uploadedBy: string;
        };
        const meta = await head(blob.url, { token: env.BLOB_READ_WRITE_TOKEN });
        await registerImage({
          caseId,
          filename: blob.pathname.split("/").pop() ?? "image",
          blobUrl: blob.url,
          blobPathname: blob.pathname,
          contentType: meta.contentType ?? "application/octet-stream",
          sizeBytes: meta.size,
          uploadedBy,
        });
      },
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "UPLOAD_FAILED" },
      { status: 400 },
    );
  }
}
