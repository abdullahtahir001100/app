import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Next.js fallback proxy for install logs when Express custom server
 * is not available. Prefer Express /api/install-logs in production.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Forward to same-origin Express if running behind custom server is uncommon
    // on pure Next — store is handled by Express route when available.
    // For Vercel-only, re-implement is heavy; return guidance.
    const base = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_APP_URL || "";
    if (!base) {
      return NextResponse.json({ success: false, message: "API base not configured" }, { status: 500 });
    }

    // If this Next route is hit on the same deployment that has Express,
    // Express already owns /api/install-logs. This exists for tooling completeness.
    return NextResponse.json({
      success: true,
      forwarded: false,
      note: "Use Express /api/install-logs on custom server deployments.",
      received: {
        step: body?.step,
        message: body?.message,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "bad request" },
      { status: 400 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ success: true, logs: [] });
}
