import { NextResponse, type NextRequest } from "next/server";

// A visitor without a session is sent to sign in before they see their account.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("harbor-session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/account/:path*"] };
