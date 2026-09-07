import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

let testMysqlConnection: any = null;

try {
  const mysqlConn = require("../../../../server/db/mysql/connection");
  testMysqlConnection = mysqlConn.testMysqlConnection;
} catch {
  // Safe load fallback
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

    let targetHost = String(host || mysqlHost || "").trim();
    targetHost = targetHost.replace(/^tcp:/i, "");
    targetHost = targetHost.replace(/(\.(?:net|com|org|io|dev|cloud|azure\.com|windows\.net|gov|edu))127\.0\.0\.1$/i, "$1");
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
