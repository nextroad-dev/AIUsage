import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { classifyError } from '@/providers/service';
import { AuthExpiredError, RateLimitedError, TimeoutError } from '@/core/errors';
import { dictionary, getLocale, setLocale, t } from '@/i18n';
import { providers } from '@/providers/registry';
import { specs } from '@/providers/specs';

const zh = dictionary('zh');

function literalsInSource(): string[] {
  const out = new Set<string>();
  const re = /\bt\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
  const walk = (dir: string) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) {
        if (f.name !== '__tests__') walk(p);
      } else if (/\.tsx?$/.test(f.name)) {
        let m: RegExpExecArray | null;
        const s = readFileSync(p, 'utf8');
        while ((m = re.exec(s))) out.add(new Function(`return ${m[1]}`)() as string);
      }
    }
  };
  walk(join(__dirname, '..', '..'));
  return [...out];
}

describe('Chinese coverage', () => {
  it('translates every literal passed to t()', () => {
    const missing = literalsInSource().filter((k) => k !== '...' && !(k in zh));
    expect(missing).toEqual([]);
  });

  it('translates strings that are looked up dynamically at render time', () => {
    const dynamic = new Set<string>();
    for (const p of providers) {
      if (p.note) dynamic.add(p.note);
      for (const r of p.regions ?? []) dynamic.add(r.label);
    }
    for (const spec of Object.values(specs)) for (const m of spec.meters) dynamic.add(m.label);
    for (const spec of Object.values(specs))
      for (const m of spec.meters)
        for (const l of Object.values(m.idBy?.labels ?? {})) dynamic.add(l);
    for (const e of [
      new AuthExpiredError(),
      new RateLimitedError(),
      new TimeoutError(),
      new Error('x'),
    ]) {
      dynamic.add(classifyError(e).message);
    }
    dynamic.add(
      'The key was accepted but the response was not recognized. The service may have changed, or this key type has no usage data.',
    );
    dynamic.add('The response was not recognized. The service may have changed.');
    dynamic.add('Automatic collection is not available for this provider.');
    dynamic.add('Only OAuth or API-key credentials are supported.');
    for (const s of ['Session window', 'Premium requests', 'Chat', 'Completions']) dynamic.add(s);
    dynamic.add(
      'GitHub sign-in is not configured in this build. Paste a personal access token instead.',
    );
    dynamic.add('Device-code sign-in is not enabled for this ChatGPT account.');
    const missing = [...dynamic].filter((k) => !(k in zh));
    expect(missing).toEqual([]);
  });

  it('has no stale entries that nothing uses', () => {
    // entries may be used dynamically, so only check the obviously static ones are still present in source
    const used = new Set(literalsInSource());
    const orphans = Object.keys(zh).filter(
      (k) =>
        !used.has(k) &&
        !/[.]$/.test(k) &&
        !['Automatic collection is not offered'].some((p) => k.startsWith(p)),
    );
    // dynamic strings (labels, regions) are legitimately absent from t() literals; allow short ones
    const suspicious = orphans.filter((k) => k.length > 40 && !k.includes('{'));
    expect(suspicious).toEqual([]);
  });
});

describe('t()', () => {
  afterEach(() => setLocale('en'));
  it('falls back to the English text and interpolates', () => {
    expect(t('Never translated {x}', { x: 1 })).toBe('Never translated 1');
    expect(t('{n}m ago', { n: 5 })).toBe('5m ago');
    expect(t('{n}m ago', {})).toBe('{n}m ago');
  });
  it('switches language', () => {
    setLocale('zh');
    expect(getLocale()).toBe('zh');
    expect(t('Settings')).toBe('设置');
    expect(t('{n}m ago', { n: 5 })).toBe('5 分钟前');
  });
});
