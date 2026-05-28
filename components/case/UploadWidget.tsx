"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  IMAGE_CONTENT_TYPES,
  IMAGE_MAX_BYTES,
} from "@/lib/constants";

type FileState = {
  key: string;
  name: string;
  status: "uploading" | "done" | "error";
  error?: string;
};

const ACCEPT = IMAGE_CONTENT_TYPES.join(",");

export function UploadWidget({
  caseId,
  mode,
}: {
  caseId: string;
  mode: "blob" | "local";
}) {
  const router = useRouter();
  const [files, setFiles] = useState<FileState[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function validate(file: File): string | null {
    if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(file.type)) {
      return "Unsupported file type";
    }
    if (file.size > IMAGE_MAX_BYTES) return "File exceeds 100 MB";
    return null;
  }

  async function uploadOne(file: File, key: string, attempt = 0): Promise<void> {
    try {
      if (mode === "blob") {
        await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          contentType: file.type,
          clientPayload: JSON.stringify({ caseId }),
        });
      } else {
        const fd = new FormData();
        fd.set("caseId", caseId);
        fd.set("file", file);
        const res = await fetch("/api/upload/local", { method: "POST", body: fd });
        if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
      }
      setFiles((prev) =>
        prev.map((f) => (f.key === key ? { ...f, status: "done" } : f)),
      );
      router.refresh();
    } catch (err) {
      // Auto-retry once on the first failure (PRODUCT §5.2).
      if (attempt === 0) return uploadOne(file, key, 1);
      setFiles((prev) =>
        prev.map((f) =>
          f.key === key
            ? { ...f, status: "error", error: err instanceof Error ? err.message : "Failed" }
            : f,
        ),
      );
    }
  }

  function onSelect(selected: FileList | null) {
    if (!selected) return;
    for (const file of Array.from(selected)) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      const error = validate(file);
      if (error) {
        setFiles((prev) => [...prev, { key, name: file.name, status: "error", error }]);
        continue;
      }
      setFiles((prev) => [...prev, { key, name: file.name, status: "uploading" }]);
      void uploadOne(file, key);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => onSelect(e.target.files)}
        />
        Upload images
      </label>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {files.map((f) => (
            <li key={f.key} className="flex items-center gap-2">
              <span className="text-muted-foreground">{f.name}</span>
              {f.status === "uploading" && <span className="text-blue-600">uploading…</span>}
              {f.status === "done" && <span className="text-green-600">✓</span>}
              {f.status === "error" && (
                <span className="text-red-600">{f.error ?? "error"}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
