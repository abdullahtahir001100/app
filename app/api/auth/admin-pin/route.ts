import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const {
  signUserToken,
  setUserAuthSession,
  AUTH_COOKIE,
  authCookieOptions,
  verifyAdminUnlockPin,
  verifyUserToken,
} = require("../../../../server/services/authService");
const { extractToken } = require("../../../../server/middleware/auth");

export async function POST(request: NextRequest) {
  try {
    const token = extractToken(request);
    const payload = await verifyUserToken(token);
    if (!payload?.sub) {
      return NextResponse.json(
        { success: false, message: "Authentication required." },
        { status: 401 }
      );
    }
    if (payload.role !== "admin") {
      return NextResponse.json(
        { success: false, message: "Admin access required." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const user = await verifyAdminUnlockPin(payload.sub, body?.pin);
    const unlocked = signUserToken(user, { adminUnlocked: true });
    await setUserAuthSession(user, unlocked);

    const response = NextResponse.json({
      success: true,
      adminUnlocked: true,
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        role: user.role,
        adminUnlocked: true,
      },
    });
    response.cookies.set(AUTH_COOKIE, unlocked, authCookieOptions());
    return response;
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number };
    return NextResponse.json(
      { success: false, message: err.message || "Invalid PIN." },
      { status: err.status || 500 }
    );
  }
}
