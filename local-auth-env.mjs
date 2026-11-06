// local-auth-env.mjs — the .env parser local-auth.mjs needs.
//
// Supports the subset a .env file here actually uses: `KEY=value` lines,
// blank lines, and `#` comments. Values may be quoted (single, double or
// backtick) — quotes are stripped — and real newlines inside a quoted value
// are collapsed to `\n`, which is what lets the \n-escaped PEM in
// service-account.json survive as a single line. Variables already present in
// the target object win, so the shell / root .env.local takes priority over
// a fallback file.

function parseValue(raw) {
  const value = raw.trim();
  // A quoted value ends at its matching closing quote; anything after it on
  // the same line is ignored, as `dotenv` does.
  const first = value[0];
  if (first === '"' || first === "'" || first === '`') {
    let out = '';
    for (let i = 1; i < value.length; i++) {
      const ch = value[i];
      if (ch === '\\' && i + 1 < value.length) {
        const next = value[i + 1];
        if (next === 'n') { out += '\n'; i++; continue; }
        out += next;
        i++;
        continue;
      }
      if (ch === first) return out;
      out += ch;
    }
    return out;
  }
  const hash = value.indexOf(' #');
  return (hash === -1 ? value : value.slice(0, hash)).trim();
}

export function parseEnvText(text, target = {}) {
  const values = {};
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  let pending = '';
  for (const line of lines) {
    const joined = pending ? `${pending}\n${line}` : line;
    pending = '';
    const trimmed = joined.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const raw = joined.slice(joined.indexOf('=') + 1);
    // An unterminated quote means the value continues on the next line.
    const probe = raw.trim();
    const quote = probe[0];
    if ((quote === '"' || quote === "'" || quote === '`') && !hasClosingQuote(probe, quote)) {
      pending = joined;
      continue;
    }
    values[key] = parseValue(raw);
  }
  for (const [key, value] of Object.entries(values)) {
    if (target[key] === undefined) target[key] = value;
  }
  return values;
}

function hasClosingQuote(text, quote) {
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === quote) return true;
  }
  return false;
}
