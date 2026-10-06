#!/usr/bin/env node
// Usage:
//   node probe.mjs list
//   node probe.mjs <provider> [--raw] [--save]
// Credentials come from environment variables only. Output is redacted by default:
// keys + types are shown, numbers/booleans/ISO dates are kept, other strings are masked.
// --raw   print full JSON responses (local terminal only; may contain personal data)
// --save  write the redacted shape to samples/<provider>.json (for snapshot tests)

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { http, shape } from "./lib.mjs";
import { providers } from "./providers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [cmd, ...flags] = process.argv.slice(2);
const raw = flags.includes("--raw");
const save = flags.includes("--save");

if (!cmd || cmd === "list" || cmd === "--help") {
  console.log("Providers:\n");
  for (const [id, p] of Object.entries(providers)) {
    console.log(`  ${id.padEnd(14)} ${p.title}`);
    console.log(`  ${"".padEnd(14)} env: ${p.env.join(", ")}${p.optionalEnv ? `  optional: ${p.optionalEnv.join(", ")}` : ""}`);
  }
  console.log("\nExample (PowerShell):  $env:OPENROUTER_API_KEY='sk-or-...'; node probe.mjs openrouter");
  process.exit(0);
}

const p = providers[cmd];
if (!p) {
  console.error(`unknown provider "${cmd}". Run: node probe.mjs list`);
  process.exit(2);
}
const missing = p.env.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`missing env: ${missing.join(", ")}`);
  process.exit(2);
}

const env = process.env;
const results = {};
const report = { provider: cmd, at: new Date().toISOString(), requests: [] };

for (const r of p.requests(env)) {
  let res;
  try {
    res = await http(r.url, r);
  } catch (e) {
    res = { status: 0, ok: false, ms: 0, error: String(e?.name === "AbortError" ? "timeout" : e) };
  }
  results[r.name] = res;
  report.requests.push({
    name: r.name,
    url: r.url,
    status: res.status,
    ms: res.ms,
    retryAfter: res.retryAfter ?? undefined,
    error: res.error,
    body: res.json !== undefined ? (raw ? res.json : shape(res.json)) : res.text,
  });
}

report.meters = p.toMeters(results, env);
report.verdict = report.meters.length > 0 ? "OK: meters parsed" : "UNSUPPORTED/EMPTY: no meters parsed — compare body shapes with the mapping";

console.log(JSON.stringify(report, null, 2));

if (save) {
  const dir = join(here, "samples");
  await mkdir(dir, { recursive: true });
  const sample = Object.fromEntries(
    report.requests.filter((r) => r.status >= 200 && r.status < 300).map((r) => [r.name, raw ? shape(results[r.name].json) : r.body]),
  );
  await writeFile(join(dir, `${cmd}.json`), JSON.stringify(sample, null, 2) + "\n");
  console.error(`saved redacted sample -> samples/${cmd}.json`);
}

process.exit(report.meters.length > 0 ? 0 : 1);
