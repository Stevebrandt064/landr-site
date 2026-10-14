// Applies text and image-path edits to index.html source safely.
// Matches are only accepted in visible HTML text/attributes or inside JS string literals,
// never inside <style>, CSS or JS code, and never as part of a longer word.

const htmlEsc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const htmlEscLite = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const jsEsc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/\n/g, '\\n');
const decodeEnt = s => s.replace(/&nbsp;/g, '\u00a0').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&rsquo;/g, '\u2019').replace(/&lsquo;/g, '\u2018').replace(/&ldquo;/g, '\u201c').replace(/&rdquo;/g, '\u201d').replace(/&mdash;/g, '\u2014').replace(/&ndash;/g, '\u2013').replace(/&amp;/g, '&');

// Find [start,end) ranges of string literals (and template chunks) inside a JS source string.
function jsStringRanges(code, offset) {
  const out = []; let i = 0, n = code.length, last = '';
  const regexOk = () => !last || /[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || /\b(return|typeof|case|do|else|in|of|new|delete|void|throw)$/.test(last);
  const tplStack = [];
  while (i < n) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') { while (i < n && code[i] !== '\n') i++; continue; }
    if (c === '/' && code[i + 1] === '*') { const e = code.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || c === '"') {
      const s = i + 1; i++;
      while (i < n && code[i] !== c) { if (code[i] === '\\') i++; i++; }
      out.push([offset + s, offset + i]); i++; last = 'x'; continue;
    }
    if (c === '`' || (c === '}' && tplStack.length && tplStack[tplStack.length - 1] === 0)) {
      if (c === '}') tplStack.pop();
      const s = i + 1; i++;
      while (i < n && code[i] !== '`' && !(code[i] === '$' && code[i + 1] === '{')) { if (code[i] === '\\') i++; i++; }
      out.push([offset + s, offset + i]);
      if (code[i] === '$') { tplStack.push(0); i += 2; last = '{'; } else { i++; last = 'x'; }
      continue;
    }
    if (c === '{') { if (tplStack.length) tplStack[tplStack.length - 1]++; }
    if (c === '}') { if (tplStack.length) tplStack[tplStack.length - 1]--; }
    if (c === '/' && regexOk()) {
      i++; let cls = false;
      while (i < n) { const d = code[i]; if (d === '\\') { i += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; i++; }
      i++; while (i < n && /[a-z]/i.test(code[i])) i++; last = 'x'; continue;
    }
    if (!/\s/.test(c)) last = (/\w/.test(c) && /\w$/.test(last)) ? last + c : (/\w/.test(c) ? c : c);
    i++;
  }
  return out;
}

// Classify the document into regions: 'html' (text/attrs), 'js' (string literal), or excluded.
export function regions(src) {
  const r = [];
  const re = /<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/gi; let m, pos = 0;
  while ((m = re.exec(src))) {
    r.push(['html', pos, m.index]);
    if (m[1].toLowerCase() === 'script' && !/\bsrc=/.test(m[0].slice(0, m[0].indexOf('>')))) {
      const off = m.index + m[0].indexOf('>') + 1;
      for (const [a, b] of jsStringRanges(m[2], off)) r.push(['js', a, b]);
    }
    pos = m.index + m[0].length;
  }
  r.push(['html', pos, src.length]);
  return r;
}

function findMatches(src, regs, oldText) {
  const cands = new Map();
  const add = (s, kind, form) => { if (s && !cands.has(s + '|' + kind)) cands.set(s + '|' + kind, { s, kind, form }); };
  add(oldText, 'html', 'raw'); add(htmlEsc(oldText), 'html', 'esc'); add(htmlEscLite(oldText), 'html', 'esc');
  add(jsEsc(oldText), 'js', 'raw'); add(jsEsc(htmlEscLite(oldText)), 'js', 'esc');
  add(oldText.replace(/'/g, "\\'"), 'js', 'raw'); add(oldText.replace(/"/g, '\\"'), 'js', 'raw');
  const startW = /^\w/.test(oldText), endW = /\w$/.test(oldText);
  const hits = new Map();
  for (const { s, kind, form } of cands.values()) {
    let i = src.indexOf(s);
    while (i >= 0) {
      const j = i + s.length;
      const okB = (!startW || !/\w/.test(src[i - 1] || '')) && (!endW || !/\w/.test(src[j] || ''));
      if (okB && !hits.has(i)) {
        const reg = regs.find(([k, a, b]) => k === kind && i >= a && j <= b);
        if (reg && (kind === 'js' || !insideTagName(src, i))) hits.set(i, { start: i, end: j, kind, form });
      }
      i = src.indexOf(s, i + 1);
    }
  }
  return [...hits.values()].sort((a, b) => a.start - b.start);
}

// True if position is inside a tag but not inside a quoted attribute value (e.g. tag/attr names).
function insideTagName(src, i) {
  const lt = src.lastIndexOf('<', i), gt = src.lastIndexOf('>', i - 1);
  if (lt <= gt) return false; // in text content
  const seg = src.slice(lt, i); const q = (seg.match(/"/g) || []).length;
  return q % 2 === 0; // even quotes => not inside an attribute value
}

function encodeFor(m, text) {
  if (m.kind === 'html') return htmlEsc(text);
  return jsEsc(m.form === 'esc' ? htmlEscLite(text) : text);
}

// edits: [{old, new, all?}]  -> returns {src, results:[{old, status, count}]}
export function applyEdits(src, edits) {
  const results = [];
  for (const e of edits) {
    const oldT = String(e.old ?? ''), newT = String(e.new ?? '');
    if (!oldT.trim() || oldT === newT) { results.push({ old: oldT, status: 'skipped' }); continue; }
    const regs = regions(src);
    let ms = findMatches(src, regs, oldT);
    if (!ms.length) ms = findMatches(src, regs, decodeEnt(oldT));
    if (!ms.length) { results.push({ old: oldT, status: 'notfound' }); continue; }
    if (ms.length > 1 && !e.all) { results.push({ old: oldT, new: newT, status: 'multiple', count: ms.length }); continue; }
    for (const m of ms.reverse()) src = src.slice(0, m.start) + encodeFor(m, newT) + src.slice(m.end);
    results.push({ old: oldT, status: 'ok', count: ms.length });
  }
  return { src, results };
}
