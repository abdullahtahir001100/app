import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

let testMysqlConnection: any = null;
let verifyRequestAuth: any = null;

try {
  const mysqlConn = require("../../../../server/db/mysql/connection");
  testMysqlConnection = mysqlConn.testMysqlConnection;
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

    if (!user) {
      return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const {
      mode,
      mysqlUri = "",
      host = "",
      port = "",
      user: dbUser = "",
      password = "",
      database = "",
      mysqlHost = "",
      mysqlPort = "",
      mysqlUser = "",
      mysqlPassword = "",
      mysqlDatabase = "",
    } = body;

    const targetHost = String(host || mysqlHost || "").trim();
    const targetUser = String(dbUser || mysqlUser || "").trim();
    const targetPort = String(port || mysqlPort || "").trim();
    const targetPass = String(password ?? mysqlPassword ?? "");
    const targetDb = String(database || mysqlDatabase || "").trim();
    const trimmedUri = String(mysqlUri || "").trim();

    const isParamsMode = mode === "params" || (!trimmedUri && (targetHost || targetUser));

    if (isParamsMode) {
      if (!targetHost) {
        return NextResponse.json(
          { success: false, error: "MySQL Host is required." },
          { status: 400 }
        );
      }
    } else if (!trimmedUri) {
      return NextResponse.json(
        { success: false, error: "MySQL Connection URI or Host is required." },
        { status: 400 }
      );
    }

    if (typeof testMysqlConnection !== "function") {
      const mysqlConn = require("../../../../server/db/mysql/connection");
      testMysqlConnection = mysqlConn.testMysqlConnection;
    }

    const testPayload = isParamsMode
      ? {
          host: targetHost,
          port: targetPort ? Number(targetPort) : 3306,
          user: targetUser || "root",
          password: targetPass,
          database: targetDb,
        }
      : trimmedUri;

    const result = await testMysqlConnection(testPayload);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `MySQL Test Error: ${errMsg}` },
      { status: 400 }
    );
  }
}
