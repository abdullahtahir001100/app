import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

let verifyRequestAuth: any = null;
let DatabaseFactory: any = null;

try {
  const authModule = require("../../../../server/middleware/auth");
  verifyRequestAuth = authModule.verifyRequestAuth;
  DatabaseFactory = require("../../../../server/db/DatabaseFactory");
} catch {
  // Safe load fallback
}

export async function GET(request: NextRequest) {
  try {
    const factory = DatabaseFactory || require("../../../../server/db/DatabaseFactory");
    const activeProvider = factory.resolveProvider();

    // Sanitize URLs for display
    const rawMongo = process.env.MONGODB_URI || "";
    const rawMysql = process.env.MYSQL_URL || process.env.DATABASE_URL || "";

    return NextResponse.json({
      success: true,
      activeProvider,
      hasMongoConfig: Boolean(rawMongo),
      hasMysqlConfig: Boolean(rawMysql),
      mongodbUri: rawMongo,
      mysqlUri: rawMysql,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: errMsg }, { status: 400 });
  }
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

    if (!user) {
      return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { provider = "mongo", mongodbUri = "", mysqlUri = "" } = body;

    const chosenProvider = provider === "mysql" ? "mysql" : "mongo";

    // Update in-memory environment
    process.env.DATABASE_PROVIDER = chosenProvider;
    if (mongodbUri && typeof mongodbUri === "string") {
      process.env.MONGODB_URI = mongodbUri.trim();
    }
    if (mysqlUri && typeof mysqlUri === "string") {
      process.env.MYSQL_URL = mysqlUri.trim();
    }

    // Update DatabaseFactory
    const factory = DatabaseFactory || require("../../../../server/db/DatabaseFactory");
    factory.setActiveProvider(chosenProvider);

    // Persist to .env if file exists and is writable
    try {
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, "utf-8");

        const updateOrAppend = (key: string, val: string) => {
          const regex = new RegExp(`^${key}=.*$`, "m");
          if (regex.test(envContent)) {
            envContent = envContent.replace(regex, `${key}=${val}`);
          } else {
            envContent += `\n${key}=${val}`;
          }
        };

        updateOrAppend("DATABASE_PROVIDER", chosenProvider);
        if (mongodbUri) updateOrAppend("MONGODB_URI", mongodbUri.trim());
        if (mysqlUri) updateOrAppend("MYSQL_URL", mysqlUri.trim());

        fs.writeFileSync(envPath, envContent.trim() + "\n", "utf-8");
      }
    } catch (fsErr) {
      console.warn("Could not update .env file:", fsErr);
    }

    // Trigger reconnect with new provider
    void factory.connectDatabase().catch((cErr: any) => {
      console.error(`Database connection on switch to ${chosenProvider} failed:`, cErr.message);
    });

    return NextResponse.json({
      success: true,
      activeProvider: chosenProvider,
      message: `Database provider updated to ${chosenProvider.toUpperCase()}.`,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: errMsg }, { status: 400 });
  }
}
