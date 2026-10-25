import { NextResponse, type NextRequest } from "next/server";

// The pages anyone may see; everything else, such as the account, needs a session.
const PUBLIC_PATHS = new Set(["/", "/about", "/pricing", "/blog", "/login"]);

// A visitor without a session is sent to sign in before they see a page that is not public.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // The framework's own files, and Roughbook's previews in development.
  if (pathname.startsWith("/_next") || pathname.startsWith("/rough-preview/")) {
    return NextResponse.next();
  }
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith("/blog/")) return NextResponse.next();
  if (!request.cookies.has("harbor-session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
