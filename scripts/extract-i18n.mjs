// Lists every t('...') literal in src (excluding tests): node scripts/extract-i18n.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const out = new Set();
const re = /\bt\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;

function walk(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name !== '__tests__') walk(p);
    } else if (/\.tsx?$/.test(f.name)) {
      const s = readFileSync(p, 'utf8');
      let m;
      while ((m = re.exec(s))) out.add(new Function(`return ${m[1]}`)());
    }
  }
}

walk('src');
console.log([...out].sort().join('\n'));
