import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (process.env.ARGUS_SELF_HOSTED === "1") {
    return NextResponse.redirect(new URL("/audit", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/",
};
