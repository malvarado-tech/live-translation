import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TRANSLATION_CLIENT_SECRET_URL =
  "https://api.openai.com/v1/realtime/translations/client_secrets";

const SUPPORTED_TARGET_LANGUAGES = new Set([
  "es", "en", "pt", "fr", "ja", "ru", "zh", "de", "ko", "hi", "id", "vi", "it",
]);

type SessionRequestBody = {
  targetLanguage?: string;
  /** When true, also mint a gpt-realtime-whisper input transcription stream.
   *  Adds ~50% to per-minute API cost. Default false. */
  captureSource?: boolean;
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: SessionRequestBody;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const targetLanguage = (body.targetLanguage ?? "en").toLowerCase();
  if (!SUPPORTED_TARGET_LANGUAGES.has(targetLanguage)) {
    return NextResponse.json(
      {
        error: `Unsupported target language "${targetLanguage}". Must be one of: ${[...SUPPORTED_TARGET_LANGUAGES].join(", ")}`,
      },
      { status: 400 },
    );
  }

  const captureSource = body.captureSource === true;

  const safetyIdentifier =
    process.env.OPENAI_SAFETY_IDENTIFIER || "live-translation-anon";

  const inputConfig: Record<string, unknown> = {
    noise_reduction: { type: "near_field" },
  };
  if (captureSource) {
    inputConfig.transcription = { model: "gpt-realtime-whisper" };
  }

  const upstream = await fetch(TRANSLATION_CLIENT_SECRET_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": safetyIdentifier,
    },
    body: JSON.stringify({
      session: {
        model: "gpt-realtime-translate",
        audio: {
          input: inputConfig,
          output: { language: targetLanguage },
        },
      },
    }),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: "OpenAI rejected the session request.",
        status: upstream.status,
        body: tryParseJson(text) ?? text,
      },
      { status: upstream.status },
    );
  }

  const data = tryParseJson(text);
  if (!data) {
    return NextResponse.json(
      { error: "OpenAI returned a non-JSON response.", body: text },
      { status: 502 },
    );
  }

  return NextResponse.json(data);
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
