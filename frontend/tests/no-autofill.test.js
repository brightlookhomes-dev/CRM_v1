import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Every text input/textarea must opt out of browser autofill suggestions (login fields keep password-manager hints).
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.jsx') ? [path.join(dir, e.name)] : []));

function tags(src) {
  const out = [];
  const re = /<(input|textarea)(?=[\s/>])/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 0; let quote = null; let i = m.index + m[0].length;
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (quote) { if (c === quote) quote = null; } else if (depth === 0 && (c === '"' || c === "'")) quote = c;
      else if (c === '{') depth += 1; else if (c === '}') depth -= 1; else if (c === '>' && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

describe('browser autofill suggestions', () => {
  it('are switched off on every input and textarea', () => {
    const offenders = [];
    for (const file of walk('src')) {
      for (const t of tags(fs.readFileSync(file, 'utf8'))) {
        if (!/autoComplete=/.test(t)) offenders.push(`${file}: ${t.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it('only the login fields and new-password keep a non-"off" value', () => {
    const allowed = [];
    for (const file of walk('src')) {
      for (const t of tags(fs.readFileSync(file, 'utf8'))) {
        const v = /autoComplete="([^"]+)"/.exec(t)?.[1];
        if (v && v !== 'off') allowed.push(v);
      }
    }
    expect(allowed.sort()).toEqual(['current-password', 'new-password', 'username']);
  });
});
