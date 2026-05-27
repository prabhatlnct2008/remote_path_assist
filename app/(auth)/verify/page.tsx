import Link from "next/link";

export default function VerifyPage() {
  return (
    <div className="flex flex-col gap-4 text-center">
      <h2 className="text-lg font-medium">Check your email</h2>
      <p className="text-sm text-muted-foreground">
        We&apos;ve sent a one-time sign-in link to your inbox. It expires in 15
        minutes. You can close this tab after clicking the link.
      </p>
      <Link href="/login" className="text-sm text-primary hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}
