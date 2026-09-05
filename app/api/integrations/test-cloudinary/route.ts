import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

let verifyRequestAuth: any = null;
try {
  const authModule = require("../../../../server/middleware/auth");
  verifyRequestAuth = authModule.verifyRequestAuth;
} catch {
  // Safe load fallback
}

export async function POST(request: NextRequest) {
  try {
    let user = null;
    if (typeof verifyRequestAuth === "function") {
      try {
        user = await Promise.race([
          verifyRequestAuth(request),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Auth timeout")), 4000)),
        ]);
      } catch {
        user = null;
      }
    }

    if (!user) {
      const authToken = request.cookies.get("auth_token")?.value;
      const authHeader = request.headers.get("authorization");
      if (authToken || (authHeader && authHeader.startsWith("Bearer "))) {
        user = { id: "session_user" };
      }
    }

    const body = await request.json().catch(() => ({}));
    const { cloudName = "", apiKey = "", apiSecret = "" } = body;

    const trimmedCloud = String(cloudName || "").trim();
    const trimmedKey = String(apiKey || "").trim();
    const trimmedSecret = String(apiSecret || "").trim();

    if (!trimmedCloud || !trimmedKey || !trimmedSecret) {
      return NextResponse.json(
        { success: false, error: "Cloud Name, API Key, and API Secret are all required." },
        { status: 400 }
      );
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    try {
      // Cloudinary Admin API ping / usage check using Basic HTTP Auth
      const credentials = Buffer.from(`${trimmedKey}:${trimmedSecret}`).toString("base64");
      const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(trimmedCloud)}/ping`;

      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Basic ${credentials}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const latencyMs = Date.now() - start;
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // If ping returns 401, check credentials
        const errDetail = data?.error?.message || `HTTP ${res.status}: Cloudinary verification rejected`;
        return NextResponse.json({
          success: false,
          latencyMs,
          error: `Cloudinary Error: ${errDetail}`,
        });
      }

      return NextResponse.json({
        success: true,
        latencyMs,
        status: data?.status || "ok",
        message: `✓ Cloudinary account "${trimmedCloud}" verified successfully (${latencyMs}ms)!`,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isAbort = (err as { name?: string })?.name === "AbortError";
      return NextResponse.json({
        success: false,
        error: isAbort ? "Request timed out connecting to Cloudinary API." : String(err),
      });
    }
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
