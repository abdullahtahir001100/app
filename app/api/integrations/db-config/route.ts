import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

let DatabaseFactory: any = null;

try {
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
    const mysqlHost = process.env.MYSQL_HOST || "";
    const mysqlPort = process.env.MYSQL_PORT || "3306";
    const mysqlDatabase = process.env.MYSQL_DATABASE || "";
    const mysqlUser = process.env.MYSQL_USER || "root";
    const mysqlPassword = process.env.MYSQL_PASSWORD || "";
    const mysqlMode = process.env.MYSQL_CONFIG_MODE || (mysqlHost ? "params" : "uri");

    let computedMysqlUri = rawMysql;
    let parsedParams: any = null;

    try {
      const mysqlConn = require("../../../../server/db/mysql/connection");
      if (rawMysql) {
        parsedParams = mysqlConn.parseMysqlConnectionString(rawMysql);
      }
      if (!computedMysqlUri && mysqlHost) {
        computedMysqlUri = mysqlConn.buildMysqlUri({
          host: mysqlHost,
          port: mysqlPort,
          user: mysqlUser,
          password: mysqlPassword,
          database: mysqlDatabase,
        });
      }
    } catch (_) {}

    return NextResponse.json({
      success: true,
      activeProvider,
      hasMongoConfig: Boolean(rawMongo),
      hasMysqlConfig: Boolean(rawMysql || mysqlHost),
      mongodbUri: rawMongo,
      mysqlUri: rawMysql || computedMysqlUri || "",
      mysqlMode,
      mysqlHost: mysqlHost || parsedParams?.host || "127.0.0.1",
      mysqlPort: mysqlPort || (parsedParams?.port ? String(parsedParams.port) : "3306"),
      mysqlDatabase: mysqlDatabase || parsedParams?.database || "",
      mysqlUser: mysqlUser || parsedParams?.user || "root",
      mysqlPassword: mysqlPassword || parsedParams?.password || "",
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: errMsg }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authToken = request.cookies.get("auth_token")?.value;
    const authHeader = request.headers.get("authorization");
    const isAuthed = Boolean(authToken || authHeader || process.env.NODE_ENV !== "production");

    if (!isAuthed) {
      return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const {
      provider = "mongo",
      mongodbUri = "",
      mysqlUri = "",
      mysqlMode = "params",
      mysqlHost = "",
      mysqlPort = "3306",
      mysqlDatabase = "",
      mysqlUser = "root",
      mysqlPassword = "",
    } = body;

    const chosenProvider = provider === "mysql" ? "mysql" : "mongo";

    // Update in-memory environment
    process.env.DATABASE_PROVIDER = chosenProvider;
    if (mongodbUri && typeof mongodbUri === "string") {
      process.env.MONGODB_URI = mongodbUri.trim();
    }

    process.env.MYSQL_CONFIG_MODE = mysqlMode;
    if (mysqlHost) process.env.MYSQL_HOST = String(mysqlHost).trim();
    if (mysqlPort) process.env.MYSQL_PORT = String(mysqlPort).trim();
    if (mysqlDatabase) process.env.MYSQL_DATABASE = String(mysqlDatabase).trim();
    if (mysqlUser) process.env.MYSQL_USER = String(mysqlUser).trim();
    if (mysqlPassword !== undefined) process.env.MYSQL_PASSWORD = String(mysqlPassword);

    let effectiveMysqlUri = String(mysqlUri || "").trim();
    try {
      const mysqlConn = require("../../../../server/db/mysql/connection");
      if (mysqlMode === "params" && mysqlHost) {
        effectiveMysqlUri = mysqlConn.buildMysqlUri({
          host: mysqlHost,
          port: mysqlPort,
          user: mysqlUser,
          password: mysqlPassword,
          database: mysqlDatabase,
        });
      } else if (effectiveMysqlUri) {
        const parsed = mysqlConn.parseMysqlConnectionString(effectiveMysqlUri);
        if (parsed) {
          if (parsed.host) process.env.MYSQL_HOST = parsed.host;
          if (parsed.port) process.env.MYSQL_PORT = String(parsed.port);
          if (parsed.user) process.env.MYSQL_USER = parsed.user;
          if (parsed.password !== undefined) process.env.MYSQL_PASSWORD = parsed.password;
          if (parsed.database) process.env.MYSQL_DATABASE = parsed.database;
        }
      }
    } catch (_) {}

    if (effectiveMysqlUri) {
      process.env.MYSQL_URL = effectiveMysqlUri;
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
        updateOrAppend("MYSQL_CONFIG_MODE", mysqlMode);
        if (effectiveMysqlUri) updateOrAppend("MYSQL_URL", effectiveMysqlUri);
        if (process.env.MYSQL_HOST) updateOrAppend("MYSQL_HOST", process.env.MYSQL_HOST);
        if (process.env.MYSQL_PORT) updateOrAppend("MYSQL_PORT", process.env.MYSQL_PORT);
        if (process.env.MYSQL_DATABASE) updateOrAppend("MYSQL_DATABASE", process.env.MYSQL_DATABASE);
        if (process.env.MYSQL_USER) updateOrAppend("MYSQL_USER", process.env.MYSQL_USER);
        if (process.env.MYSQL_PASSWORD !== undefined) updateOrAppend("MYSQL_PASSWORD", process.env.MYSQL_PASSWORD);

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
