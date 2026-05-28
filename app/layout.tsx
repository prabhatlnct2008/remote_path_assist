import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PathConsult",
  description: "Remote pathology consultation platform for AIIMS Delhi.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
