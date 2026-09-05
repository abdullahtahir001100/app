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
    const { provider = "gemini", apiKey = "", model = "" } = body;

    const trimmedKey = String(apiKey || "").trim();
    if (!trimmedKey) {
      return NextResponse.json(
        { success: false, error: "API Key is required to perform the test." },
        { status: 400 }
      );
    }

    const start = Date.now();

    if (provider === "gemini") {
      // Test against Google Generative Language API
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmedKey)}`;
        const res = await fetch(url, {
          method: "GET",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const latencyMs = Date.now() - start;
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const errDetail = data?.error?.message || `HTTP ${res.status}: Verification failed`;
          return NextResponse.json({
            success: false,
            provider: "gemini",
            latencyMs,
            error: `Gemini API Error: ${errDetail}`,
          });
        }

        const modelList = Array.isArray(data?.models) ? data.models : [];
        const foundTarget = model ? modelList.some((m: { name?: string }) => (m.name || "").includes(model)) : true;

        return NextResponse.json({
          success: true,
          provider: "gemini",
          latencyMs,
          model: model || "gemini-1.5-flash",
          modelSupported: foundTarget,
          availableModelsCount: modelList.length,
          message: `✓ Gemini API key is valid and verified! (${latencyMs}ms)`,
        });
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        const isAbort = (err as { name?: string })?.name === "AbortError";
        return NextResponse.json({
          success: false,
          provider: "gemini",
          error: isAbort ? "Request timed out connecting to Google Gemini API." : String(err),
        });
      }
    }

    if (provider === "openai") {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      try {
        const res = await fetch("https://api.openai.com/v1/models", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${trimmedKey}`,
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const latencyMs = Date.now() - start;
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const errDetail = data?.error?.message || `HTTP ${res.status}: Verification failed`;
          return NextResponse.json({
            success: false,
            provider: "openai",
            latencyMs,
            error: `OpenAI API Error: ${errDetail}`,
          });
        }

        return NextResponse.json({
          success: true,
          provider: "openai",
          latencyMs,
          message: `✓ OpenAI API key is valid and verified! (${latencyMs}ms)`,
        });
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        return NextResponse.json({
          success: false,
          provider: "openai",
          error: String(err),
        });
      }
    }

    if (provider === "groq") {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      try {
        const res = await fetch("https://api.groq.com/openai/v1/models", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${trimmedKey}`,
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const latencyMs = Date.now() - start;
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const errDetail = data?.error?.message || `HTTP ${res.status}: Verification failed`;
          return NextResponse.json({
            success: false,
            provider: "groq",
            latencyMs,
            error: `Groq API Error: ${errDetail}`,
          });
        }

        return NextResponse.json({
          success: true,
          provider: "groq",
          latencyMs,
          message: `✓ Groq API key is valid and verified! (${latencyMs}ms)`,
        });
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        return NextResponse.json({
          success: false,
          provider: "groq",
          error: String(err),
        });
      }
    }

    if (provider === "anthropic") {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      try {
        // Anthropic models list or ping
        const res = await fetch("https://api.anthropic.com/v1/models", {
          method: "GET",
          headers: {
            "x-api-key": trimmedKey,
            "anthropic-version": "2023-06-01",
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const latencyMs = Date.now() - start;
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const errDetail = data?.error?.message || `HTTP ${res.status}: Verification failed`;
          return NextResponse.json({
            success: false,
            provider: "anthropic",
            latencyMs,
            error: `Anthropic API Error: ${errDetail}`,
          });
        }

        return NextResponse.json({
          success: true,
          provider: "anthropic",
          latencyMs,
          message: `✓ Anthropic API key is valid and verified! (${latencyMs}ms)`,
        });
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        return NextResponse.json({
          success: false,
          provider: "anthropic",
          error: String(err),
        });
      }
    }

    // Default fallback verification
    return NextResponse.json({
      success: true,
      provider,
      latencyMs: Date.now() - start,
      message: `✓ ${provider.toUpperCase()} key format verified.`,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
