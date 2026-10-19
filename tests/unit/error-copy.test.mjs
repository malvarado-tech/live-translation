import assert from "node:assert/strict";
import { test } from "node:test";
import { describeOperatorError, extractServerMessage } from "../../lib/error-copy.ts";

test("raw JSON bodies are reduced to their message", () => {
  assert.equal(
    extractServerMessage('Session creation failed (500): {"error":"OPENAI_API_KEY is not configured on the server."}'),
    "OPENAI_API_KEY is not configured on the server.",
  );
  assert.equal(extractServerMessage("plain"), "plain");
  assert.equal(extractServerMessage('x {"error":{"message":"nested"}}'), "nested");
});

test("known failures get a cause and a fix", () => {
  const key = describeOperatorError(
    "Translation",
    'Session creation failed (500): {"error":"OPENAI_API_KEY is not configured on the server."}',
  );
  assert.equal(key.title, "Translation engine not configured");
  assert.match(key.fix, /OPENAI_API_KEY/);
  assert.equal(key.detail, "OPENAI_API_KEY is not configured on the server.");

  assert.equal(
    describeOperatorError("Room", "LIVEKIT_API_KEY / LIVEKIT_API_SECRET not configured on the server.").title,
    "Room server credentials missing",
  );
  assert.equal(describeOperatorError("Mic", "NotAllowedError: Permission denied").title, "Microphone access blocked");
  assert.equal(describeOperatorError("Room", "could not establish signal connection").title, "Room server unreachable");
  assert.equal(describeOperatorError("Translation", "Auto-reconnect gave up after 3 attempts").title,
    "Translation stopped after repeated reconnection attempts");
});

test("unknown failures still read as a sentence and keep the detail", () => {
  const e = describeOperatorError("Room", "weird");
  assert.equal(e.title, "Room error");
  assert.equal(e.detail, "weird");
  for (const v of Object.values(e)) assert.ok(!v.includes("—"));
});
