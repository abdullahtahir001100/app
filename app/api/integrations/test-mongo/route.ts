import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const { verifyRequestAuth } = require("../../../../server/middleware/auth");
const mongoose = require("mongoose");

export async function POST(request: NextRequest) {
  let tempConn: any = null;
  try {
    const user = await verifyRequestAuth(request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { mongodbUri = "" } = body;

    const trimmedUri = String(mongodbUri || "").trim();
    if (!trimmedUri) {
      return NextResponse.json(
        { success: false, error: "MongoDB Connection URI is required." },
        { status: 400 }
      );
    }

    if (!trimmedUri.startsWith("mongodb://") && !trimmedUri.startsWith("mongodb+srv://")) {
      return NextResponse.json(
        { success: false, error: "Invalid URI format. Must begin with 'mongodb://' or 'mongodb+srv://'." },
        { status: 400 }
      );
    }

    const start = Date.now();

    // Create an isolated temporary connection to test credentials & cluster ping
    tempConn = mongoose.createConnection(trimmedUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });

    await tempConn.asPromise();
    
    if (tempConn.readyState === 1 && tempConn.db) {
      await tempConn.db.admin().ping();
    }

    const latencyMs = Date.now() - start;
    const dbName = tempConn.name || "zenvora";
    const host = tempConn.host || "cluster";

    await tempConn.close();
    tempConn = null;

    return NextResponse.json({
      success: true,
      latencyMs,
      dbName,
      host,
      message: `✓ Successfully connected to MongoDB database "${dbName}" (${latencyMs}ms ping)!`,
    });
  } catch (error: unknown) {
    if (tempConn) {
      try {
        await tempConn.close();
      } catch (_) {}
    }

    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      success: false,
      error: `MongoDB Connection Failed: ${errMsg}`,
    });
  }
}
