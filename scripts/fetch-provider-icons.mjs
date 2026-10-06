import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Regenerates src/ui/provider-icons.ts from the upstream brand sets.
 *
 * Stores each mark as its viewBox plus the individual path data, so the component renders with
 * <Svg>/<Path> instead of handing an XML string to SvgXml (which needs a full <svg> document and
 * silently renders nothing otherwise).
 */

const https = await import('node:https');

const get = (url) =>
  new Promise((resolve) => {
    https
      .get(url, { headers: { 'user-agent': 'node', accept: '*/*' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return get(new URL(res.headers.location, url).href).then(resolve);
        }
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', (e) => resolve({ status: 0, body: String(e.message) }));
  });

/** providerId -> upstream icon */
const SOURCES = {
  codex: 'lobehub:openai',
  copilot: 'simple:github',
  'kimi-code': 'lobehub:kimi',
  'kimi-balance': 'lobehub:kimi',
  openrouter: 'lobehub:openrouter',
  minimax: 'lobehub:minimax',
  zai: 'lobehub:zai',
  runway: 'lobehub:runway',
  poe: 'lobehub:poe',
  deepseek: 'lobehub:deepseek',
  'opencode-go': 'lobehub:opencode',
  opencode: 'lobehub:opencode',
  claude: 'lobehub:claude',
  cursor: 'lobehub:cursor',
};

const urlFor = (ref) => {
  const [kind, slug] = ref.split(':');
  return kind === 'lobehub'
    ? `https://unpkg.com/@lobehub/icons-static-svg/icons/${slug}.svg`
    : `https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/${slug}.svg`;
};

const parse = (svg) => {
  const root = svg.match(/<svg[^>]*>/)?.[0] ?? '';
  const viewBox = root.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 24 24';
  const paths = [];
  for (const [, attrs] of svg.matchAll(/<path\b([^>]*)\/?>/g)) {
    const d = attrs.match(/\bd="([^"]+)"/)?.[1];
    if (!d) continue;
    const rule = attrs.match(/fill-rule="([^"]+)"/)?.[1];
    const extra = attrs
      .replace(/\bd="[^"]*"/g, '')
      .replace(/fill-rule="[^"]*"/g, '')
      .replace(/clip-rule="[^"]*"/g, '')
      .replace(/fill="[^"]*"/g, '')
      .trim();
    paths.push({ d, evenOdd: rule === 'evenodd', extra });
  }
  return { viewBox, paths };
};

const entries = [];
let warnings = 0;

for (const [id, ref] of Object.entries(SOURCES)) {
  const res = await get(urlFor(ref));
  if (res.status !== 200) {
    console.log(`FAIL ${id} (${ref}) status ${res.status}`);
    process.exitCode = 1;
    continue;
  }
  const { viewBox, paths } = parse(res.body);
  const noisy = paths.filter((p) => p.extra.length > 0);
  if (noisy.length) {
    warnings++;
    console.log(`note ${id}: kept extra attributes on ${noisy.length} path(s)`);
  }
  entries.push({ id, viewBox, paths });
  console.log(`ok ${id.padEnd(14)} viewBox=${viewBox} paths=${paths.length}`);
}

const data = entries
  .map(
    ({ id, viewBox, paths }) =>
      `  ${JSON.stringify(id)}: {\n    viewBox: ${JSON.stringify(viewBox)},\n    paths: [\n` +
      paths
        .map((p) => `      { d: ${JSON.stringify(p.d)}${p.evenOdd ? ', evenOdd: true' : ''} },`)
        .join('\n') +
      `\n    ],\n  },`,
  )
  .join('\n');

const file = `/**
 * Official provider marks, stored as structured path data so the component can render them with
 * <Svg>/<Path> and tint them with the theme text colour (see ui/provider-icon.tsx).
 *
 * Sources: @lobehub/icons-static-svg (AI brand set) and simple-icons (GitHub).
 * Brands remain the property of their owners; used here only to identify the provider.
 *
 * Regenerate with scripts/fetch-provider-icons.mjs when a brand updates its mark.
 */
export interface ProviderMark {
  viewBox: string;
  paths: { d: string; evenOdd?: boolean }[];
}

export const providerIcons: Record<string, ProviderMark> = {
${data}
};
`;

writeFileSync('src/ui/provider-icons.ts', file);
console.log(`\nwrote ${entries.length} marks, ${warnings} with extra attributes`);
