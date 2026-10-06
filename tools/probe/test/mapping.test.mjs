import { test } from "node:test";
import assert from "node:assert/strict";
import { shape } from "../lib.mjs";
import { providers } from "../providers.mjs";

const res = (json) => ({ status: 200, ok: true, json });

test("shape masks strings, keeps numbers and ISO dates", () => {
  const s = shape({ email: "a@b.c", n: 3, d: "2026-10-06T00:00:00Z", arr: [1, 2, 3] });
  assert.equal(s.email, "<string:5>");
  assert.equal(s.n, 3);
  assert.equal(s.d, "2026-10-06T00:00:00Z");
  assert.equal(s.arr.length, 3);
});

test("openrouter maps credits and key limits", () => {
  const m = providers.openrouter.toMeters({
    credits: res({ data: { total_credits: 10, total_usage: 2.5 } }),
    key: res({ data: { limit: 5, usage: 1, usage_daily: 0.2 } }),
  });
  assert.deepEqual(m.find((x) => x.id === "credits").kind, { type: "balance", value: 7.5, unit: "USD" });
  assert.equal(m.find((x) => x.id === "key_limit").kind.limit, 5);
  assert.ok(m.find((x) => x.id === "usage_daily"));
});

test("openrouter tolerates missing fields", () => {
  assert.deepEqual(providers.openrouter.toMeters({ credits: res({}), key: res({ data: {} }) }), []);
});

test("zai distinguishes 5h and weekly by unit", () => {
  const m = providers.zai.toMeters({
    quota: res({ data: { limits: [
      { type: "TOKENS_LIMIT", unit: 3, percentage: 40, nextResetTime: 1790000000000 },
      { type: "TOKENS_LIMIT", unit: 6, percentage: 10, nextResetTime: 1790500000000 },
      { type: "TIME_LIMIT", unit: 5, percentage: 1 },
    ] } }),
  });
  assert.deepEqual(m.map((x) => x.id), ["session", "weekly"]);
  assert.equal(m[0].kind.used, 40);
});

test("kimi-balance maps available balance", () => {
  const m = providers["kimi-balance"].toMeters({ balance: res({ data: { available_balance: 49.5 } }) }, {});
  assert.equal(m[0].kind.value, 49.5);
});

test("runway maps credit balance", () => {
  const m = providers.runway.toMeters({ org: res({ creditBalance: 5000 }) });
  assert.equal(m[0].kind.value, 5000);
});
