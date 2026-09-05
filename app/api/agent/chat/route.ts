import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chat is handled by Express (`server/routes/agent.js` POST /api/agent/chat)
 * under the custom server so the request body is not double-parsed.
 * This Next route is a fallback only (e.g. `next dev` without server.js).
 */
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error:
        "Use the Node custom server (server.js). /api/agent/chat is served by Express to avoid body-lock errors.",
    },
    { status: 501 }
  );
}
