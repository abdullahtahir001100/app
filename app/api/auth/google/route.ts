import { NextRequest, NextResponse } from "next/server";
const crypto = require("crypto");

export const runtime = "nodejs";

const {
  upsertGoogleUser,
  signUserToken,
  setUserAuthSession,
  AUTH_COOKIE,
  authCookieOptions,
  ensureAuthDatabase
} = require("../../../../server/services/authService");
const { getConnectionRegistry } = require("../../../../server/sockets/registry");
const { forceLogoutUserDashboards } = require("../../../../server/sockets/fanout");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_STATE_COOKIE = "google_oauth_state";

function clearStateCookie(response: NextResponse) {
  response.cookies.set(GOOGLE_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");
  const stateCookie = request.cookies.get(GOOGLE_STATE_COOKIE)?.value || "";
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${appOrigin}/api/auth/google`;

  const redirectToLogin = (errorCode: string) => {
    const response = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(errorCode)}`, appOrigin));
    clearStateCookie(response);
    return response;
  };

  try {
    if (error) {
      return redirectToLogin(error);
    }

    if (!code) {
      if (!GOOGLE_CLIENT_ID) {
        return redirectToLogin("google-not-configured");
      }

      const generatedState = crypto.randomBytes(16).toString("hex");

      const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorizeUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
      authorizeUrl.searchParams.set("redirect_uri", googleRedirectUri);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("scope", "openid email profile");
      authorizeUrl.searchParams.set("state", generatedState);
      authorizeUrl.searchParams.set("access_type", "offline");
      authorizeUrl.searchParams.set("prompt", "consent");

      const response = NextResponse.redirect(authorizeUrl);
      response.cookies.set(GOOGLE_STATE_COOKIE, generatedState, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 10 * 60,
      });
      return response;
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return redirectToLogin("google-not-configured");
    }

    if (!state || !stateCookie || state !== stateCookie) {
      return redirectToLogin("google-state-mismatch");
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirectUri,
        grant_type: "authorization_code"
      })
    });

    const tokenData = await tokenResponse.json().catch(() => ({}));
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return redirectToLogin("google-token-exchange-failed");
    }

    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const profile = await profileResponse.json().catch(() => ({}));
    const email = profile.email;
    const name = profile.name;
    const picture = profile.picture;
    const sub = profile.id;

    if (!email || !sub) {
      console.error("[GOOGLE AUTH] Incomplete profile:", profile);
      return redirectToLogin("google-auth-failed");
    }

    await ensureAuthDatabase();

    const user = await upsertGoogleUser({
      email,
      name,
      picture,
      id: String(sub),
      sub: String(sub)
    });

    const token = signUserToken(user);
    await setUserAuthSession(user, token);
    try {
      forceLogoutUserDashboards(getConnectionRegistry(), String(user._id || user.id), "session_replaced");
    } catch {
      // registry may be unavailable in some Next-only deployments
    }

    const dest = user.role === "admin" ? "/admin-pin?next=%2Fdashboard" : "/dashboard";
    const response = NextResponse.redirect(new URL(dest, appOrigin));
    response.cookies.set(AUTH_COOKIE, token, authCookieOptions());
    clearStateCookie(response);
    return response;
  } catch (callbackError) {
    console.error("[GOOGLE AUTH] Callback failed:", callbackError);
    const message = callbackError instanceof Error ? callbackError.message : "google-auth-failed";
    if (message.includes("JWT_SECRET is required")) {
      return redirectToLogin("auth-not-configured");
    }
    if (
      message.includes("MONGODB_URI") ||
      message.includes("Database") ||
      message.includes("buffering timed out") ||
      message.includes("Server selection timed out") ||
      message.includes("ECONNREFUSED") ||
      message.includes("ENOTFOUND") ||
      message.includes("ER_") ||
      message.includes("PROTOCOL_")
    ) {
      return redirectToLogin("database-unavailable");
    }
    return redirectToLogin("google-auth-failed");
  }
}
