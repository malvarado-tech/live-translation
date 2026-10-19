import assert from "node:assert/strict";
import { test } from "node:test";
import { signToken } from "../../lib/livekit-token.ts";

function grants(jwt) {
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
  return payload.video;
}

test("listener tokens are subscribe-only; publisher tokens may set status", async () => {
  process.env.LIVEKIT_API_KEY = "unit-test-key";
  process.env.LIVEKIT_API_SECRET = "unit-test-secret-unit-test-secret";
  const listener = grants(await signToken({ room: "demo-es", identity: "l1", role: "listener" }));
  assert.equal(listener.room, "demo-es");
  assert.equal(listener.canSubscribe, true);
  assert.equal(listener.canPublish, false);
  assert.equal(listener.canPublishData, false);
  assert.ok(!listener.canUpdateOwnMetadata);

  const publisher = grants(await signToken({ room: "demo-es", identity: "o1", role: "publisher" }));
  assert.equal(publisher.canPublish, true);
  assert.equal(publisher.canSubscribe, false);
  assert.equal(publisher.canUpdateOwnMetadata, true);
});
