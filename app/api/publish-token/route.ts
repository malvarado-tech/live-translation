import { NextResponse } from "next/server";
import { signToken } from "@/lib/livekit-token";

export const dynamic = "force-dynamic";

type Body = {
  room?: string;
  identity?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const room = sanitizeSlug(body.room ?? "");
  const identity = sanitizeSlug(body.identity ?? `operator-${randomId()}`);

  if (!room) {
    return NextResponse.json(
      { error: "room is required (lowercase alphanumerics + dashes)." },
      { status: 400 },
    );
  }

  try {
    const token = await signToken({
      room,
      identity,
      role: "publisher",
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
  return Math.random().toString(36).slice(2, 8);
}
