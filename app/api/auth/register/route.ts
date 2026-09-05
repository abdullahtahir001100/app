import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const {
  registerUser,
  signUserToken,
  setUserAuthSession,
  AUTH_COOKIE,
  authCookieOptions
} = require("../../../../server/services/authService");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const user = await registerUser(body);
    const token = signUserToken(user);
    await setUserAuthSession(user, token);
    const response = NextResponse.json({
      success: true,
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        role: user.role,
        adminUnlocked: user.role !== "admin"
      }
    });
    response.cookies.set(AUTH_COOKIE, token, authCookieOptions());
    return response;
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number };
    return NextResponse.json(
      { success: false, message: err.message || "Registration failed." },
      { status: err.status || 500 }
    );
  }
}
