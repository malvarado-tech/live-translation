/**
 * Realtime translation client.
 *
 * Opens a WebRTC peer connection to OpenAI's gpt-realtime-translate endpoint.
 * Captures microphone audio, streams it to OpenAI, and exposes the translated
 * audio MediaStreamTrack to the caller — who can choose to play it locally
 * (audioSink), republish it (e.g., to a LiveKit room), or both.
 *
 * Auto-reconnect:
 *   The OpenAI realtime session has a ~1h hard ceiling. When the peer
 *   connection enters `failed`, we mint a fresh client_secret, build a new
 *   RTCPeerConnection, re-do SDP, and emit the new translated track via
 *   onTrack. The shared mic MediaStream is preserved across reconnects.
 *   Up to 3 attempts with backoff [1s, 2s, 5s]; the attempt counter resets
 *   after 60s of stable `connected`. The user's stop() bypasses all of this.
 */

const SDP_URL = "https://api.openai.com/v1/realtime/translations/calls";

const RECONNECT_BACKOFF_MS = [1000, 2000, 5000] as const;
const MAX_RECONNECT_ATTEMPTS = RECONNECT_BACKOFF_MS.length;
const STABILITY_WINDOW_MS = 60_000;

export type RealtimeStatus =
  | "idle"
  | "creating-session"
  | "negotiating"
  | "live"
  | "closed"
  | "error";

export type RealtimeEvent =
  | { type: "status"; status: RealtimeStatus }
  | { type: "source-transcript"; delta: string }
  | { type: "translated-transcript"; delta: string }
  | { type: "first-audio-received"; latencyMs: number }
  | { type: "token-expiry"; expiresAtMs: number }
  | { type: "reconnect"; attempt: number; delayMs: number }
  | { type: "error"; message: string };

export type RealtimeListener = (event: RealtimeEvent) => void;

export type StartSessionOptions = {
  targetLanguage: string;
  /** Listener callback for status/transcript/latency events. */
  onEvent: RealtimeListener;
  /** Optional: route the translated audio to this <audio> element. */
  audioSink?: HTMLAudioElement | null;
  /** Optional: also route the translated audio to this second <audio> element
   *  (useful to play the audio at default device for screen-share tab audio
   *  while the primary sink targets a specific monitor headphone). */
  broadcastSink?: HTMLAudioElement | null;
  /** Optional: called with the translated MediaStreamTrack whenever it
   *  arrives. Called once per successful connect — i.e., once on initial
   *  start, and once again per successful auto-reconnect. The caller is
   *  responsible for replacing any previously published/recorded track. */
  onTrack?: (track: MediaStreamTrack) => void;
  /** Optional: shared MediaStream for the mic. If omitted, getUserMedia is called. */
  micStream?: MediaStream;
  /** When true, request input transcription (gpt-realtime-whisper). Adds ~50% to API cost. */
  captureSource?: boolean;
};

export type RealtimeSession = {
  stop: () => Promise<void>;
};

type ClientSecretResponse = {
  value?: string;
  client_secret?: { value?: string };
  expires_at?: number;
};

export async function startSession(
  opts: StartSessionOptions,
): Promise<RealtimeSession> {
  const {
    targetLanguage,
    audioSink,
    broadcastSink,
    onEvent,
    onTrack,
    micStream,
    captureSource = false,
  } = opts;

  let pc: RTCPeerConnection | null = null;
  let ownedMicStream: MediaStream | null = null;
  let sharedMic: MediaStream | null = null;
  let firstMicChunkAt: number | null = null;
  let firstAudioReceivedReported = false;
  let userRequestedStop = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stabilityTimer: ReturnType<typeof setTimeout> | null = null;

  function emit(event: RealtimeEvent) {
    try {
      onEvent(event);
    } catch (err) {
      console.error("[realtime] listener threw", err);
    }
  }

  /** Tear down the current peer connection without releasing the mic. */
  function softClosePc() {
    try {
      pc?.getSenders().forEach((sender) => {
        try {
          // Don't stop mic tracks — we reuse them on reconnect.
          if (sender.track && sender.track.kind !== "audio") {
            sender.track.stop();
          }
        } catch {
          // ignore
        }
      });
      pc?.close();
    } finally {
      pc = null;
    }
  }

  async function stop() {
    userRequestedStop = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (stabilityTimer) {
      clearTimeout(stabilityTimer);
      stabilityTimer = null;
    }
    softClosePc();
    ownedMicStream?.getTracks().forEach((track) => track.stop());
    ownedMicStream = null;
    sharedMic = null;
    emit({ type: "status", status: "closed" });
  }

  async function fetchClientSecret(): Promise<string> {
    const sessionResponse = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetLanguage, captureSource }),
    });
    if (!sessionResponse.ok) {
      const text = await sessionResponse.text();
      throw new Error(
        `Session creation failed (${sessionResponse.status}): ${text}`,
      );
    }
    const sessionData = (await sessionResponse.json()) as ClientSecretResponse;
    const clientSecret =
      sessionData.client_secret?.value ?? sessionData.value;
    if (!clientSecret) {
      throw new Error(
        `No client_secret in session response: ${JSON.stringify(sessionData)}`,
      );
    }
    if (typeof sessionData.expires_at === "number") {
      const raw = sessionData.expires_at;
      const expiresAtMs = raw < 1e12 ? raw * 1000 : raw;
      emit({ type: "token-expiry", expiresAtMs });
    }
    return clientSecret;
  }

  function scheduleReconnect(reason: string) {
    if (userRequestedStop) return;
    if (reconnectTimer) return; // already scheduled
    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      emit({
        type: "error",
        message: `Auto-reconnect gave up after ${MAX_RECONNECT_ATTEMPTS} attempts (${reason}). Click Stop translation, then Start translation, to try again.`,
      });
      emit({ type: "status", status: "closed" });
      return;
    }
    const delay = RECONNECT_BACKOFF_MS[reconnectAttempt];
    reconnectAttempt++;
    emit({ type: "reconnect", attempt: reconnectAttempt, delayMs: delay });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (userRequestedStop) return;
      void connect().catch((err) => {
        emit({
          type: "error",
          message: `Reconnect attempt ${reconnectAttempt} failed: ${(err as Error).message}`,
        });
        scheduleReconnect(`attempt ${reconnectAttempt} failed`);
      });
    }, delay);
  }

  async function connect(): Promise<void> {
    if (userRequestedStop) return;
    emit({ type: "status", status: "creating-session" });

    const clientSecret = await fetchClientSecret();

    if (userRequestedStop) return;
    emit({ type: "status", status: "negotiating" });

    if (!sharedMic) {
      const audioSource =
        micStream ??
        (await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        }));
      if (!micStream) {
        ownedMicStream = audioSource;
      }
      sharedMic = audioSource;
    }

    if (userRequestedStop) return;

    pc = new RTCPeerConnection();
    // Reset first-token tracking for this connect cycle.
    firstAudioReceivedReported = false;

    pc.ontrack = ({ streams, track }) => {
      const stream = streams[0];
      if (audioSink && stream) {
        audioSink.srcObject = stream;
        audioSink.play().catch((err) => {
          emit({
            type: "error",
            message: `Audio playback rejected: ${(err as Error).message}. User may need to interact with the page first or unmute the tab.`,
          });
        });
      }
      if (broadcastSink && stream) {
        broadcastSink.srcObject = stream;
        broadcastSink.play().catch(() => {
          // ignore — broadcast sink is best-effort
        });
      }
      if (onTrack && track) {
        try {
          onTrack(track);
        } catch (err) {
          console.error("[realtime] onTrack threw", err);
        }
      }
    };

    const thisPc = pc;
    pc.onconnectionstatechange = () => {
      if (thisPc !== pc) return; // stale handler from a torn-down PC
      if (pc?.connectionState === "failed") {
        emit({ type: "error", message: "WebRTC connection failed." });
        // Surface "error" status BEFORE softClosePc so telemetry counts the
        // disconnect (live → error). softClose then transitions error → idle
        // implicitly; the reconnect path re-emits creating-session → live.
        emit({ type: "status", status: "error" });
        softClosePc();
        scheduleReconnect("WebRTC peer entered failed state");
      } else if (pc?.connectionState === "connected") {
        // Reset the attempt counter after a stable stretch — protects against
        // the case where a flaky network burns through all 3 attempts before
        // a real problem hits. If we stay connected 60s, we're "healthy."
        if (stabilityTimer) clearTimeout(stabilityTimer);
        stabilityTimer = setTimeout(() => {
          if (pc?.connectionState === "connected") {
            reconnectAttempt = 0;
          }
        }, STABILITY_WINDOW_MS);
      }
    };

    const events = pc.createDataChannel("oai-events");
    events.onmessage = ({ data }) => {
      let event: { type?: string; delta?: string };
      try {
        event = JSON.parse(data);
      } catch {
        return;
      }

      if (event.type === "session.output_transcript.delta" && event.delta) {
        if (!firstAudioReceivedReported && firstMicChunkAt !== null) {
          firstAudioReceivedReported = true;
          emit({
            type: "first-audio-received",
            latencyMs: performance.now() - firstMicChunkAt,
          });
        }
        emit({ type: "translated-transcript", delta: event.delta });
      } else if (
        event.type === "session.input_transcript.delta" &&
        event.delta
      ) {
        emit({ type: "source-transcript", delta: event.delta });
      }
    };

    for (const track of sharedMic.getAudioTracks()) {
      pc.addTrack(track, sharedMic);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    firstMicChunkAt = performance.now();

    const sdpResponse = await fetch(SDP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp ?? "",
    });
    if (!sdpResponse.ok) {
      const text = await sdpResponse.text();
      throw new Error(
        `SDP exchange failed (${sdpResponse.status}): ${text}`,
      );
    }

    await pc.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text(),
    });

    if (userRequestedStop) {
      softClosePc();
      return;
    }
    emit({ type: "status", status: "live" });
  }

  try {
    await connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message });
    emit({ type: "status", status: "error" });
    await stop();
    throw err;
  }

  return { stop };
}
