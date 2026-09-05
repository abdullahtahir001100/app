import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const { ensureMongooseConnected } = require("../../../../server/db/mongo/connection");
const { verifyRequestAuth } = require("../../../../server/middleware/auth");
const mongoose = require("mongoose");

export async function GET(request: NextRequest) {
  const start = Date.now();
  const checks: Record<string, unknown> = {};

  // 1. Check API Route Base Health
  checks.api = {
    status: "ok",
    latencyMs: 0,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  };

  // 2. Check MongoDB Connection & Ping Latency
  const dbStart = Date.now();
  try {
    await ensureMongooseConnected();
    const isConnected = mongoose.connection.readyState === 1;
    let dbPingMs = Date.now() - dbStart;
    
    if (isConnected && mongoose.connection.db) {
      await mongoose.connection.db.admin().ping();
      dbPingMs = Date.now() - dbStart;
    }

    checks.database = {
      status: isConnected ? "connected" : "connecting",
      readyState: mongoose.connection.readyState,
      dbName: mongoose.connection.name || "zenvora",
      pingMs: dbPingMs,
      ok: isConnected,
    };
  } catch (err: unknown) {
    checks.database = {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      pingMs: Date.now() - dbStart,
      ok: false,
    };
  }

  // 3. Check Session / Authentication
  try {
    const user = await verifyRequestAuth(request);
    checks.auth = {
      status: user ? "authenticated" : "unauthenticated",
      userId: user?.id || null,
      email: user?.email || null,
      hasPairingToken: Boolean(user?.pairingToken),
      ok: Boolean(user),
    };
  } catch (err: unknown) {
    checks.auth = {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      ok: false,
    };
  }

  const totalDurationMs = Date.now() - start;
  (checks.api as Record<string, unknown>).latencyMs = totalDurationMs;

  const allOk = Boolean(
    (checks.database as Record<string, unknown>)?.ok &&
    (checks.auth as Record<string, unknown>)?.ok
  );

  return NextResponse.json({
    success: true,
    allOk,
    durationMs: totalDurationMs,
    checks,
  });
}
