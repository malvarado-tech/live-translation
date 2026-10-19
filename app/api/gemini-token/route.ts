import { GoogleGenAI, Modality } from "@google/genai";
import { NextResponse } from "next/server";
import { buildGeminiSystemInstruction } from "@/lib/gemini-instruction";

export const dynamic = "force-dynamic";

const SESSION_START_WINDOW_MS = 1 * 60 * 1000; // 1 min to start the WS
const TOKEN_LIFETIME_MS = 30 * 60 * 1000; // 30 min to send messages
const GEMINI_MODEL = "gemini-3.1-flash-live-preview";

type Body = {
  /** Display label for the target language (e.g. "English", "Português"). */
  targetLanguageLabel?: string;
  /** When true, also request input-audio transcription. */
  captureSource?: boolean;
};

export async function POST(request: Request) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_AI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    body = {};
  }
  const targetLanguageLabel = body.targetLanguageLabel ?? "English";
  const captureSource = body.captureSource === true;

  // Bake the translation-style system instruction into the ephemeral token's
  // constraints. The constrained Live endpoint enforces what was declared at
  // mint time, if we only sent the instruction in the post-connect setup
  // message, it could be silently ignored (which manifested as Gemini's
  // native-audio mirror-language behavior: Spanish in → Spanish out).
  const systemInstruction = buildGeminiSystemInstruction(targetLanguageLabel);

  type LiveConfig = {
    responseModalities: Modality[];
    systemInstruction: { parts: { text: string }[] };
    outputAudioTranscription: Record<string, never>;
    inputAudioTranscription?: Record<string, never>;
  };
  const liveConfig: LiveConfig = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    outputAudioTranscription: {},
  };
  if (captureSource) liveConfig.inputAudioTranscription = {};

  try {
    const ai = new GoogleGenAI({ apiKey });
    const now = Date.now();

    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + TOKEN_LIFETIME_MS).toISOString(),
        newSessionExpireTime: new Date(
          now + SESSION_START_WINDOW_MS,
        ).toISOString(),
        liveConnectConstraints: {
          model: GEMINI_MODEL,
          config: liveConfig,
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });

    return NextResponse.json({
      token: token.name,
      model: GEMINI_MODEL,
      targetLanguageLabel,
      // Absolute ms timestamp when the message window closes, used by the
      // operator telemetry panel for the token-expiry countdown.
      expiresAtMs: now + TOKEN_LIFETIME_MS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
