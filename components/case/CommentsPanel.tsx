"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteComment, editComment, postComment } from "@/actions/comments";
import { Markdown } from "@/components/case/Markdown";
import type { CommentThread } from "@/lib/db/queries/comments";
import { relativeTime } from "@/lib/utils/time";

function Composer({
  caseId,
  parentId,
  placeholder,
  onDone,
}: {
  caseId: string;
  parentId?: string;
  placeholder: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!body.trim()) return;
    const fd = new FormData();
    fd.set("caseId", caseId);
    fd.set("body", body);
    if (parentId) fd.set("parentId", parentId);
    startTransition(async () => {
      const res = await postComment(fd);
      if (res.ok) {
        setBody("");
        setError(null);
        router.refresh();
        onDone?.();
      } else {
        setError("Could not post comment.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={pending || !body.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Posting…" : "Post"}
        </button>
        {onDone && (
          <button onClick={onDone} className="text-sm text-muted-foreground hover:underline">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function CommentBody({
  c,
  currentUserId,
}: {
  c: CommentThread | CommentThread["replies"][number];
  currentUserId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const [pending, startTransition] = useTransition();
  const isAi = c.actorKind === "ai";
  const isAuthor = c.authorId === currentUserId;
  const editable = isAuthor && !c.deletedAt && c.editLockedAt != null && c.editLockedAt > Date.now();

  function saveEdit() {
    const fd = new FormData();
    fd.set("commentId", c.id);
    fd.set("body", draft);
    startTransition(async () => {
      await editComment(fd);
      setEditing(false);
      router.refresh();
    });
  }

  function remove() {
    const fd = new FormData();
    fd.set("commentId", c.id);
    startTransition(async () => {
      await deleteComment(fd);
      router.refresh();
    });
  }

  return (
    <div className={`rounded-md border p-3 ${isAi ? "border-violet-200 bg-violet-50/50" : "border-border"}`}>
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        {isAi ? (
          <span className="rounded-full bg-violet-200 px-2 py-0.5 font-medium text-violet-800">
            AI
          </span>
        ) : (
          <span className="font-medium text-foreground">{c.authorName ?? "Unknown"}</span>
        )}
        <span>{relativeTime(c.createdAt)}</span>
        {c.updatedAt > c.createdAt && !c.deletedAt && <span>(edited)</span>}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button onClick={saveEdit} disabled={pending} className="text-sm text-primary hover:underline">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="text-sm text-muted-foreground hover:underline">
              Cancel
            </button>
          </div>
        </div>
      ) : c.deletedAt ? (
        <p className="text-sm italic text-muted-foreground">[deleted]</p>
      ) : (
        <Markdown>{c.body}</Markdown>
      )}

      {!editing && !c.deletedAt && isAuthor && (
        <div className="mt-2 flex gap-3 text-xs">
          {editable && (
            <button onClick={() => setEditing(true)} className="text-muted-foreground hover:underline">
              Edit
            </button>
          )}
          <button onClick={remove} disabled={pending} className="text-red-600 hover:underline">
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function CommentsPanel({
  caseId,
  threads,
  currentUserId,
  canComment,
}: {
  caseId: string;
  threads: CommentThread[];
  currentUserId: string;
  canComment: boolean;
}) {
  const [replyTo, setReplyTo] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {threads.length === 0 && (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      )}
      {threads.map((t) => (
        <div key={t.id} className="flex flex-col gap-2">
          <CommentBody c={t} currentUserId={currentUserId} />
          {t.replies.length > 0 && (
            <div className="ml-6 flex flex-col gap-2">
              {t.replies.map((r) => (
                <CommentBody key={r.id} c={r} currentUserId={currentUserId} />
              ))}
            </div>
          )}
          {canComment && (
            <div className="ml-6">
              {replyTo === t.id ? (
                <Composer
                  caseId={caseId}
                  parentId={t.id}
                  placeholder="Write a reply…"
                  onDone={() => setReplyTo(null)}
                />
              ) : (
                <button
                  onClick={() => setReplyTo(t.id)}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Reply
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {canComment && (
        <div className="border-t border-border pt-4">
          <Composer caseId={caseId} placeholder="Add a comment… (Markdown, @mentions)" />
        </div>
      )}
    </div>
  );
}
