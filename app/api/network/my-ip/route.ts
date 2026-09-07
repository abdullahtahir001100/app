import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip");
  let ip = forwarded ? forwarded.split(",")[0].trim() : (realIp || "127.0.0.1");
  if (ip.startsWith("::ffff:")) {
    ip = ip.substring(7);
  }
  return NextResponse.json({ ip });
}
