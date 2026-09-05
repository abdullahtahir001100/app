import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const { verifyRequestAuth } = require("../../../../server/middleware/auth");

export async function POST(request: NextRequest) {
  try {
    const user = await verifyRequestAuth(request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
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
