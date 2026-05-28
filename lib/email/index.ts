import { env } from "@/lib/env";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends a transactional email via Resend. Without RESEND_API_KEY (local dev),
 * the message is logged to the server console instead of sent.
 */
export async function sendEmail(input: SendEmailInput) {
  if (!env.RESEND_API_KEY) {
    console.log(
      `\n──────── [DEV EMAIL] ────────\nto:      ${input.to}\nsubject: ${input.subject}\n\n${input.text}\n─────────────────────────────\n`,
    );
    return { ok: true as const, dev: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
  }
  return { ok: true as const };
}
