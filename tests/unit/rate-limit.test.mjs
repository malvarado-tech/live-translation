import assert from "node:assert/strict";
import { test } from "node:test";
import { createRateLimiter } from "../../lib/rate-limit.ts";

test("allows up to the limit within a window, then blocks", () => {
  const rl = createRateLimiter({ limit: 3, windowMs: 1000 });
  assert.equal(rl.hit("a", 0), true);
  assert.equal(rl.hit("a", 10), true);
  assert.equal(rl.hit("a", 20), true);
  assert.equal(rl.hit("a", 30), false);
  assert.equal(rl.hit("b", 30), true, "keys are independent");
});

test("a new window resets the count", () => {
  const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(rl.hit("a", 0), true);
  assert.equal(rl.hit("a", 999), false);
  assert.equal(rl.hit("a", 1000), true);
});

test("tracked keys stay bounded", () => {
  const rl = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100 });
  for (let i = 0; i < 1000; i++) rl.hit(`k${i}`, i);
  assert.ok(rl.size() <= 100, `size ${rl.size()}`);
});
