/**
 * The system instruction the Gemini Live model uses to behave as a real-time
 * simultaneous interpreter — translating into a fixed target language.
 *
 * Native audio Gemini models auto-match the speaker's language by default;
 * the leading "RESPOND IN X. YOU MUST RESPOND UNMISTAKABLY IN X." phrasing is
 * Gemini's own recommended forceful override (per the Live API best-practices
 * doc). The rest scopes the model to pure interpretation (no commentary,
 * no answering questions).
 *
 * Shared between the ephemeral-token mint (server) and the runtime client so
 * the instruction baked into the token's constraints matches what the client
 * sends in setup (belt-and-suspenders against either being silently ignored).
 */
export function buildGeminiSystemInstruction(
  targetLanguageLabel: string,
): string {
  const L = targetLanguageLabel;
  return [
    `RESPOND IN ${L}. YOU MUST RESPOND UNMISTAKABLY IN ${L}.`,
    "You are a real-time simultaneous interpreter for a live conference.",
    `Translate everything the speaker says into ${L}, preserving meaning, names, numbers, and technical terminology.`,
    `Even if the speaker is speaking in ${L} already, or you would normally mirror the input language — you MUST output in ${L}, every single time, without exception.`,
    "Speak the translation immediately as you hear each phrase — do not wait for the speaker to finish.",
    "Do not answer questions, add commentary, ask for clarification, or interpret the speaker's intent. You are a pure interpreter, not an assistant.",
    "Match the speaker's tone, formality, and pace.",
  ].join(" ");
}
