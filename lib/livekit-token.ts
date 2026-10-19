/**
 * Server-side LiveKit token signer.
 *
 * Never call from a client-side module: these tokens grant publish/subscribe
 * permissions, and the API secret must stay on the server.
 */
import { AccessToken } from "livekit-server-sdk";

export type TokenRole = "publisher" | "listener";

export type TokenOptions = {
  room: string;
  identity: string;
  role: TokenRole;
  /** Optional display name shown in the LiveKit dashboard / debug UIs. */
  name?: string;
  /** Token lifetime in seconds. Default 6 hours, fine for a single event. */
  ttlSeconds?: number;
};

export async function signToken(opts: TokenOptions): Promise<string> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error(
      "LIVEKIT_API_KEY / LIVEKIT_API_SECRET not configured on the server.",
    );
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity: opts.identity,
    name: opts.name ?? opts.identity,
    ttl: opts.ttlSeconds ?? 6 * 60 * 60,
  });

  if (opts.role === "publisher") {
    token.addGrant({
      room: opts.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: false,
      canPublishData: true,
      // Lets the operator publish its session status as participant
      // attributes (lib/session-status.ts). Listener tokens never get it.
      canUpdateOwnMetadata: true,
    });
  } else {
    token.addGrant({
      room: opts.room,
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
  }

  return token.toJwt();
}
