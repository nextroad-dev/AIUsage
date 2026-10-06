// Provider probes. Each entry:
//   env:     required environment variables (credentials are never read from disk or args)
//   requests(env): list of { name, url, method?, headers?, body? }
//   toMeters(responses): tolerant mapping to Meter[]  (unknown/missing fields are skipped, never thrown)
// Endpoint facts and their confidence: docs/provider-api-auth.md

import { amount, balance, num, percent, requireEnv, toIso } from "./lib.mjs";

const bearer = (k) => ({ Authorization: `Bearer ${k}`, Accept: "application/json" });

export const providers = {
  openrouter: {
    title: "OpenRouter (official)",
    env: ["OPENROUTER_API_KEY"],
    requests: (env) => [
      { name: "key", url: "https://openrouter.ai/api/v1/key", headers: bearer(env.OPENROUTER_API_KEY) },
      { name: "credits", url: "https://openrouter.ai/api/v1/credits", headers: bearer(env.OPENROUTER_API_KEY) },
    ],
    toMeters({ key, credits }) {
      const meters = [];
      const k = key?.json?.data;
      const c = credits?.json?.data;
      if (c) {
        const total = num(c.total_credits), used = num(c.total_usage);
        if (total !== undefined && used !== undefined) meters.push(balance("credits", "Credits balance", total - used, "USD"));
      }
      if (k) {
        const limit = num(k.limit);
        if (limit !== undefined) meters.push(amount("key_limit", "Key spend limit", num(k.usage) ?? 0, limit, "USD"));
        for (const [id, f] of [["usage_daily", "Today"], ["usage_weekly", "This week"], ["usage_monthly", "This month"]]) {
          const v = num(k[id]);
          if (v !== undefined) meters.push(amount(id, `Spend: ${f}`, v, undefined, "USD"));
        }
      }
      return meters;
    },
  },

  poe: {
    title: "Poe (official)",
    env: ["POE_API_KEY"],
    requests: (env) => [
      { name: "balance", url: "https://api.poe.com/usage/current_balance", headers: bearer(env.POE_API_KEY) },
      { name: "history", url: "https://api.poe.com/usage/points_history", headers: bearer(env.POE_API_KEY) },
    ],
    toMeters({ balance: b }) {
      const j = b?.json;
      // Field name unverified: accept the common candidates.
      const v = num(j?.current_point_balance); // official field name
      return v === undefined ? [] : [balance("points", "Points balance", v, "points")];
    },
  },

  "kimi-balance": {
    title: "Kimi Open Platform balance (official)",
    env: ["MOONSHOT_API_KEY"],
    optionalEnv: ["KIMI_REGION (intl|cn, default intl)"],
    requests: (env) => {
      const host = env.KIMI_REGION === "cn" ? "api.moonshot.cn" : "api.moonshot.ai";
      return [{ name: "balance", url: `https://${host}/v1/users/me/balance`, headers: bearer(env.MOONSHOT_API_KEY) }];
    },
    toMeters({ balance: b }, env) {
      const d = b?.json?.data;
      const v = num(d?.available_balance);
      return v === undefined ? [] : [balance("balance", "Available balance", v, env.KIMI_REGION === "cn" ? "CNY" : "USD")];
    },
  },

  "kimi-code": {
    title: "Kimi Code plan (internal)",
    env: ["KIMI_CODE_API_KEY"],
    optionalEnv: ["KIMI_REGION (intl|cn, default intl)"],
    requests: (env) => {
      const host = env.KIMI_REGION === "cn" ? "api.kimi.com" : "api.kimi.ai";
      return [{ name: "usages", url: `https://${host}/coding/v1/usages`, headers: bearer(env.KIMI_CODE_API_KEY) }];
    },
    toMeters({ usages }) {
      const j = usages?.json;
      const meters = [];
      const u = j?.usage;
      if (u && num(Number(u.limit)) !== undefined) {
        const limit = Number(u.limit), used = Number(u.used ?? limit - Number(u.remaining ?? 0));
        meters.push(amount("monthly", "Monthly", used, limit, "units", toIso(u.resetTime)));
      }
      for (const l of Array.isArray(j?.limits) ? j.limits : []) {
        const d = l?.detail ?? l;
        const limit = Number(d?.limit), used = Number(d?.used ?? limit - Number(d?.remaining));
        if (Number.isFinite(limit) && Number.isFinite(used)) {
          meters.push(amount("session", "5-hour window", used, limit, "units", toIso(d?.resetTime)));
        }
      }
      return meters;
    },
  },

  runway: {
    title: "Runway API organization (official; NOT web subscription credits)",
    env: ["RUNWAYML_API_SECRET"],
    requests: (env) => [
      {
        name: "org",
        url: "https://api.dev.runwayml.com/v1/organization",
        headers: { ...bearer(env.RUNWAYML_API_SECRET), "X-Runway-Version": "2024-11-06" },
      },
    ],
    toMeters({ org }) {
      const j = org?.json;
      const meters = [];
      const bal = num(j?.creditBalance);
      if (bal !== undefined) meters.push(balance("credits", "API credit balance", bal, "credits"));
      return meters;
    },
  },

  minimax: {
    title: "MiniMax Coding Plan (internal)",
    env: ["MINIMAX_CODING_API_KEY"],
    optionalEnv: ["MINIMAX_REGION (intl|cn, default intl)"],
    requests: (env) => {
      const host = env.MINIMAX_REGION === "cn" ? "platform.minimaxi.com" : "platform.minimax.io";
      return [{ name: "remains", url: `https://${host}/v1/api/openplatform/coding_plan/remains`, headers: bearer(env.MINIMAX_CODING_API_KEY) }];
    },
    toMeters({ remains }) {
      const rows = remains?.json?.model_remains;
      const meters = [];
      for (const r of Array.isArray(rows) ? rows : []) {
        const total = num(r.current_interval_total_count), left = num(r.current_interval_usage_count);
        if (total === undefined || left === undefined) continue;
        meters.push(amount("session", "5-hour window", total - left, total, "prompts", toIso(r.end_time), { type: "model", name: String(r.model_name ?? "") }));
      }
      return meters;
    },
  },

  // Discovery probes: the response shape is not documented anywhere reliable. They print the
  // redacted shape so a Spec can be written from it. toMeters intentionally returns [].
  factory: {
    title: "Factory / Droid (discovery: prints response shape only)",
    env: ["FACTORY_API_KEY"],
    requests: (env) => [
      { name: "limits", url: "https://api.factory.ai/api/billing/limits", headers: bearer(env.FACTORY_API_KEY) },
    ],
    toMeters: () => [],
  },
  amp: {
    title: "Amp (discovery: prints response shape only; request body unknown)",
    env: ["AMP_API_KEY"],
    requests: (env) => [
      { name: "balance", url: "https://ampcode.com/api/internal?userDisplayBalanceInfo", method: "POST", headers: { ...bearer(env.AMP_API_KEY), "Content-Type": "application/json" }, body: {} },
    ],
    toMeters: () => [],
  },

  // Cookie-session providers: set the env var to the Cookie header copied from a desktop browser
  // (DevTools > Network > any request to the site > Request Headers > Cookie). Discovery probes
  // print the redacted response shape only; toMeters intentionally returns [].
  cursor: {
    title: "Cursor dashboard (cookie session, internal)",
    env: ["CURSOR_COOKIE"],
    requests: (env) => [
      { name: "summary", url: "https://cursor.com/api/usage-summary", headers: { Cookie: env.CURSOR_COOKIE, Origin: "https://cursor.com", Referer: "https://cursor.com/dashboard", Accept: "application/json" } },
    ],
    toMeters({ summary }) {
      const j = summary?.json;
      const meters = [];
      for (const [id, label, node] of [["monthly", "Monthly", j?.individualUsage?.plan], ["on_demand", "On-demand", j?.individualUsage?.onDemand]]) {
        const used = num(node?.used), limit = num(node?.limit);
        if (used === undefined || !limit) continue;
        meters.push(percent(id, label, (used / limit) * 100, toIso(j?.billingCycleEnd)));
      }
      return meters;
    },
  },
  perplexity: {
    title: "Perplexity (discovery: prints response shape only)",
    env: ["PERPLEXITY_COOKIE"],
    requests: (env) => [
      { name: "credits", url: "https://www.perplexity.ai/rest/billing/credits?version=2.18&source=default", headers: { Cookie: env.PERPLEXITY_COOKIE, Origin: "https://www.perplexity.ai", Referer: "https://www.perplexity.ai/account/usage", Accept: "application/json" } },
    ],
    toMeters: () => [],
  },
  augment: {
    title: "Augment Code (discovery: prints response shape only)",
    env: ["AUGMENT_COOKIE"],
    requests: (env) => [
      { name: "credits", url: "https://app.augmentcode.com/api/credits", headers: { Cookie: env.AUGMENT_COOKIE, Accept: "application/json" } },
      { name: "subscription", url: "https://app.augmentcode.com/api/subscription", headers: { Cookie: env.AUGMENT_COOKIE, Accept: "application/json" } },
    ],
    toMeters: () => [],
  },

  zai: {
    title: "z.ai / GLM Coding Plan (internal)",
    env: ["ZAI_API_KEY"],
    optionalEnv: ["ZAI_REGION (intl|cn, default intl)"],
    requests: (env) => {
      const host = env.ZAI_REGION === "cn" ? "open.bigmodel.cn" : "api.z.ai";
      return [{ name: "quota", url: `https://${host}/api/monitor/usage/quota/limit`, headers: bearer(env.ZAI_API_KEY) }];
    },
    toMeters({ quota }) {
      const limits = quota?.json?.data?.limits;
      const meters = [];
      for (const l of Array.isArray(limits) ? limits : []) {
        if (l?.type !== "TOKENS_LIMIT") continue;
        const pct = num(l.percentage);
        if (pct === undefined) continue;
        // unit 3 = 5-hour window, unit 6 = weekly (community-reported; verify)
        const id = l.unit === 3 ? "session" : l.unit === 6 ? "weekly" : `tokens_unit_${l.unit}`;
        meters.push(percent(id, id === "session" ? "5-hour window" : id === "weekly" ? "Weekly" : id, pct, toIso(l.nextResetTime)));
      }
      return meters;
    },
  },
};

export { requireEnv };
