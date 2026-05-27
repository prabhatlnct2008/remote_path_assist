import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Layer 1 of the defense-in-depth in ARCHITECTURE §7: redirect anonymous
// requests on protected routes to /login. Real validation (session, active
// status, role) happens in the (app) layout and in each Server Action, which
// run on the Node runtime with DB access. Middleware only checks for the
// presence of a session cookie so it stays edge-compatible.
export function middleware(req: NextRequest) {
  const hasSession =
    req.cookies.has("authjs.session-token") ||
    req.cookies.has("__Secure-authjs.session-token");

  if (!hasSession) {
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/cases/:path*", "/admin/:path*", "/welcome/:path*"],
};
