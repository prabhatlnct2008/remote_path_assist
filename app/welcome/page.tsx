import { redirect } from "next/navigation";
import { setName } from "@/actions/auth";
import { currentUser } from "@/lib/auth/guards";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  // Already named — nothing to capture.
  if (user.name && user.name.trim() !== "") redirect("/cases");

  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Before you continue, please tell us your full name as it should appear
          on cases and reports.
        </p>
      </div>
      <form action={setName} className="flex flex-col gap-4">
        <label htmlFor="name" className="text-sm font-medium">
          Full name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
          placeholder="Dr. Asha Verma"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        {error === "NameRequired" && (
          <p role="alert" className="text-sm text-red-600">
            Please enter your full name (2–120 characters).
          </p>
        )}
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Continue
        </button>
      </form>
    </main>
  );
}
