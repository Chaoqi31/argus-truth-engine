import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  const next = safeNext(searchParams.get("next"));

  if (providerError) {
    return NextResponse.redirect(errorUrl(origin, next, providerError));
  }

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      if (process.env.NODE_ENV !== "development" && forwardedHost) {
        return NextResponse.redirect(withSignedInFlag(`https://${forwardedHost}`, next));
      }
      return NextResponse.redirect(withSignedInFlag(origin, next));
    }
    return NextResponse.redirect(errorUrl(origin, next, error.message));
  }

  return NextResponse.redirect(errorUrl(origin, next, "missing_oauth_code"));
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/app";
  return value;
}

function withSignedInFlag(origin: string, next: string): string {
  const url = new URL(next, origin);
  url.searchParams.set("signedIn", "1");
  return url.toString();
}

function errorUrl(origin: string, next: string, reason: string): string {
  const url = new URL("/auth/auth-code-error", origin);
  url.searchParams.set("next", next);
  url.searchParams.set("reason", reason.slice(0, 160));
  return url.toString();
}
