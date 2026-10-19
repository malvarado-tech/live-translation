import { NextResponse } from "next/server";
import {
  getEventLanguages,
  UpstreamBusyError,
} from "@/lib/event-languages-server";
import { slugify } from "@/lib/event-rooms";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// The event page polls every 15 s; 30 requests a minute per client leaves
// room for manual refreshes and several tabs behind one address.
const perClient = createRateLimiter({ limit: 30, windowMs: 60_000 });

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
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

  if (!perClient.hit(clientKey(request))) {
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
