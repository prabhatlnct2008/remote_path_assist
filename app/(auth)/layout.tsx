export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-6">
      <div className="text-center">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          AIIMS Delhi · Pathology
        </span>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">PathConsult</h1>
      </div>
      {children}
    </main>
  );
}
