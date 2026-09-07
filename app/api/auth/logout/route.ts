import { NextResponse } from "next/server";

export const runtime = "nodejs";

const { AUTH_COOKIE, clearUserAuthSession, verifyUserToken } = require("../../../../server/services/authService");

export async function POST(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  const token = cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${AUTH_COOKIE}=`));
  const value = token ? token.split("=")[1] : "";
  const payload = await verifyUserToken(decodeURIComponent(value));
  if (payload?.sub) {
    await clearUserAuthSession(payload.sub);
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
