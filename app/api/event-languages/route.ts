import { NextResponse } from "next/server";
import {
  getEventLanguages,
  UpstreamBusyError,
} from "@/lib/event-languages-server";
import { slugify } from "@/lib/event-rooms";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// The event page and the listener page poll every 15 s and each operator
// tab every 5 s; 30 requests a minute per client leaves room for manual
// refreshes and several tabs behind one address.
const perClient = createRateLimiter({ limit: 30, windowMs: 60_000 });

// Without a proxy in front (the usual LAN setup) there is no client address
// in the headers, and every phone would share one 30-a-minute bucket. Those
// requests share a larger budget instead; the per-event cache and the
// upstream budget in lib/event-languages-server.ts still cap LiveKit calls.
const SHARED_KEY = "direct";
const shared = createRateLimiter({ limit: 1_200, windowMs: 60_000, maxKeys: 1 });

function clientKey(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const event = slugify(searchParams.get("event") ?? "");
  if (!event) {
    return NextResponse.json(
      { error: "event query parameter is required." },
      { status: 400 },
    );
  }

  const key = clientKey(request);
  const allowed = key ? perClient.hit(key) : shared.hit(SHARED_KEY);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  try {
    const result = await getEventLanguages(event);
    return NextResponse.json(
      { event, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof UpstreamBusyError) {
      return NextResponse.json(
        { error: "Busy. Try again in a few seconds." },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    }
    console.error(
      "[event-languages] LiveKit lookup failed:",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { error: "Could not reach the translation server." },
      { status: 502 },
    );
  }
}
