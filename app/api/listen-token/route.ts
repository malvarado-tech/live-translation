import { NextResponse } from "next/server";
import { signToken } from "@/lib/livekit-token";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const room = sanitizeSlug(searchParams.get("room") ?? "");
  if (!room) {
    return NextResponse.json(
      { error: "room query parameter is required." },
      { status: 400 },
    );
  }

  const identity = `listener-${randomId()}`;

  try {
    const token = await signToken({
      room,
      identity,
      role: "listener",
      name: identity,
    });
    return NextResponse.json({
      token,
      url: process.env.NEXT_PUBLIC_LIVEKIT_URL,
      room,
      identity,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function sanitizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
