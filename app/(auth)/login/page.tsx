import { signInWithEmail } from "@/actions/auth";

const ERROR_MESSAGES: Record<string, string> = {
  InvalidEmail: "Please enter a valid email address.",
  AccessDenied: "That email hasn't been invited. Contact your administrator.",
  Verification: "That sign-in link is invalid or has expired.",
  SignInFailed: "Something went wrong. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error
    ? (ERROR_MESSAGES[error] ?? "Unable to sign in. Please try again.")
    : null;

  return (
    <form action={signInWithEmail} className="flex flex-col gap-4">
      <label htmlFor="email" className="text-sm font-medium">
        Institutional email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@aiims.edu"
        className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      />
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
      <button
        type="submit"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Send sign-in link
      </button>
      <p className="text-center text-xs text-muted-foreground">
        Access is by invitation only. A one-time link will be emailed to you.
      </p>
    </form>
  );
}
