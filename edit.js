/* Landr site editor. Loads only on /edit. Click text to change it, click an image to replace it, then Save. */
(function () {
  'use strict';
  const ENDPOINT = '/.netlify/functions/edit';
  const SKIP = 'script,style,svg,input,textarea,select,option,noscript,video,iframe,#ed-bar,#ed-login,#ed-toast';
  let pw = '', mode = 'edit';
  const tracked = new Map(); // element -> snapshot [{node,val}]
  const images = [];         // {img, oldSrc, name, data}
  const store = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };

  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
  body.ed-on [data-ed-hover]{outline:2px dashed #FF6555!important;outline-offset:3px;cursor:text}
  body.ed-on img[data-ed-hover]{cursor:pointer}
  [data-ed-active]{outline:2px solid #FF6555!important;outline-offset:3px;background:rgba(255,101,85,.08)}
  [data-ed-changed]{box-shadow:0 0 0 2px rgba(255,101,85,.35)}
  #ed-bar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;background:#171515;color:#fff;padding:10px 12px;border-radius:12px;box-shadow:0 12px 40px -10px rgba(0,0,0,.6);font:600 14px/1 Inter,Arial,sans-serif;max-width:calc(100vw - 24px)}
  #ed-bar button{font:inherit;border:0;border-radius:8px;padding:11px 14px;cursor:pointer;background:#2c2827;color:#fff}
  #ed-bar button[aria-pressed=true]{background:#fff;color:#171515}
  #ed-bar .save{background:#FF6555;color:#171515}
  #ed-bar .save:disabled{opacity:.45;cursor:default}
  #ed-bar .count{padding:0 6px;color:rgba(255,255,255,.75);font-weight:500}
  #ed-login{position:fixed;inset:0;z-index:2147483001;background:rgba(23,21,21,.85);display:grid;place-items:center;font-family:Inter,Arial,sans-serif}
  #ed-login form{background:#fff;color:#171515;padding:28px;border-radius:14px;width:min(360px,calc(100vw - 32px));display:grid;gap:12px}
  #ed-login h2{margin:0;font-size:24px;letter-spacing:-.02em}
  #ed-login input{font:16px Inter,Arial,sans-serif;padding:13px;border:1.5px solid #171515;border-radius:8px}
  #ed-login button{font:600 16px Inter,Arial,sans-serif;padding:14px;border:0;border-radius:8px;background:#171515;color:#fff;cursor:pointer}
  #ed-login p{margin:0;font-size:14px;color:#b3261e;min-height:1em}
  #ed-toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:2147483000;background:#fff;color:#171515;border:2px solid #171515;padding:12px 16px;border-radius:10px;font:500 15px/1.4 Inter,Arial,sans-serif;max-width:min(560px,calc(100vw - 24px));box-shadow:0 10px 30px -12px rgba(0,0,0,.5)}`;
  document.head.appendChild(css);

  const $el = (tag, attrs = {}, kids = []) => { const e = document.createElement(tag); Object.assign(e, attrs); kids.forEach(k => e.append(k)); return e; };
  let toastT;
  function toast(msg, ms = 5000) {
    let t = document.getElementById('ed-toast'); if (!t) { t = $el('div', { id: 'ed-toast', role: 'status' }); document.body.append(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(toastT); if (ms) toastT = setTimeout(() => t.hidden = true, ms);
  }
  async function call(body) {
    const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw, ...body }) });
    const j = await r.json().catch(() => ({ error: 'Unexpected response from the server.' }));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong.'), { status: r.status });
    return j;
  }

  /* ---------- login ---------- */
  function login() {
    const err = $el('p'), input = $el('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password', required: true });
    const form = $el('form', {}, [$el('h2', { textContent: 'Edit landr.com.au' }), input, $el('button', { type: 'submit', textContent: 'Start editing' }), err]);
    const wrap = $el('div', { id: 'ed-login' }, [form]);
    form.onsubmit = async e => {
      e.preventDefault(); err.textContent = ''; pw = input.value;
      try { await call({ action: 'check' }); store.set('ed-pw', pw); wrap.remove(); start(); }
      catch (x) { err.textContent = x.message; }
    };
    document.body.append(wrap); input.focus();
  }

  /* ---------- toolbar ---------- */
  let bar, countEl, saveBtn, editBtn, browseBtn;
  function start() {
    editBtn = $el('button', { type: 'button', textContent: 'Edit' });
    browseBtn = $el('button', { type: 'button', textContent: 'Browse' });
    countEl = $el('span', { className: 'count' });
    saveBtn = $el('button', { type: 'button', className: 'save', textContent: 'Save' });
    const undo = $el('button', { type: 'button', textContent: 'Discard' });
    const exit = $el('button', { type: 'button', textContent: 'Exit' });
    bar = $el('div', { id: 'ed-bar', role: 'toolbar', ariaLabel: 'Site editor' }, [editBtn, browseBtn, countEl, saveBtn, undo, exit]);
    document.body.append(bar);
    editBtn.onclick = () => setMode('edit'); browseBtn.onclick = () => setMode('browse');
    saveBtn.onclick = save;
    undo.onclick = () => { if (dirtyCount() && confirm('Discard all unsaved changes?')) location.reload(); };
    exit.onclick = () => { if (dirtyCount() && !confirm('You have unsaved changes. Leave anyway?')) return; location.href = '/' + location.hash; };
    setMode('edit'); refresh();
    toast('Click any text to change it, or click an image to replace it. Use Browse to open menus and pages, then switch back to Edit.', 8000);
  }
  function setMode(m) {
    mode = m; document.body.classList.toggle('ed-on', m === 'edit');
    editBtn.setAttribute('aria-pressed', m === 'edit'); browseBtn.setAttribute('aria-pressed', m === 'browse');
    if (m === 'browse') deactivate();
  }

  /* ---------- finding editable text ---------- */
  const hasOwnText = el => [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
  function editableFor(t) {
    for (let el = t; el && el !== document.body; el = el.parentElement) {
      if (el.closest(SKIP)) return null;
      if (hasOwnText(el)) {
        // prefer the outermost text block (e.g. a <p> containing <b>)
        let top = el;
        for (let p = el.parentElement; p && p !== document.body && !p.closest(SKIP); p = p.parentElement) {
          if (hasOwnText(p) && getComputedStyle(p).display !== 'flex' && getComputedStyle(p).display !== 'grid') top = p; else break;
        }
        return top;
      }
    }
    return null;
  }
  const textNodes = el => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const a = []; while (w.nextNode()) a.push(w.currentNode); return a; };

  let active = null;
  function activate(el) {
    deactivate();
    if (!tracked.has(el)) tracked.set(el, { nodes: textNodes(el).map(n => ({ node: n, val: n.nodeValue })), whole: el.textContent, leaf: !el.children.length });
    try { el.contentEditable = 'plaintext-only'; } catch { el.contentEditable = 'true'; }
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.setAttribute('data-ed-active', ''); active = el; el.focus();
  }
  function deactivate() {
    if (!active) return; const el = active; active = null;
    el.removeAttribute('contenteditable'); el.removeAttribute('data-ed-active');
    el.toggleAttribute('data-ed-changed', changesFor(el).length > 0); refresh();
  }

  function changesFor(el) {
    const s = tracked.get(el); if (!s) return [];
    const now = textNodes(el);
    if (s.leaf || now.length !== s.nodes.length) {
      const a = s.whole.trim(), b = el.textContent.trim();
      if (a === b) return [];
      return s.leaf || !s.nodes.length ? [{ old: a, new: b }] : [{ old: a, new: b, broken: true }];
    }
    const out = [];
    s.nodes.forEach((o, i) => { const a = o.val.trim(), b = now[i].nodeValue.trim(); if (a !== b && a) out.push({ old: a, new: b }); });
    return out;
  }
  const allChanges = () => [...tracked.keys()].flatMap(changesFor);
  const dirtyCount = () => allChanges().length + images.length;
  function refresh() { const n = dirtyCount(); countEl.textContent = n ? `${n} unsaved change${n > 1 ? 's' : ''}` : 'No changes'; saveBtn.disabled = !n; }

  /* ---------- events ---------- */
  let hoverEl = null;
  document.addEventListener('mouseover', e => {
    if (mode !== 'edit') return;
    const t = e.target.tagName === 'IMG' && !e.target.closest(SKIP) ? e.target : editableFor(e.target);
    if (hoverEl && hoverEl !== t) hoverEl.removeAttribute('data-ed-hover');
    hoverEl = t; if (t) t.setAttribute('data-ed-hover', '');
  }, true);

  document.addEventListener('click', e => {
    if (mode !== 'edit' || !bar || e.target.closest('#ed-bar,#ed-toast,#ed-login')) return;
    // Space/Enter while typing inside a button or link fires a synthetic click: swallow it, keep editing.
    if (active && e.detail === 0) { e.preventDefault(); e.stopPropagation(); return; }
    const img = e.target.closest('img');
    if (img && !img.closest(SKIP)) { e.preventDefault(); e.stopPropagation(); pickImage(img); return; }
    const el = editableFor(e.target);
    if (el) { e.preventDefault(); e.stopPropagation(); if (el !== active) activate(el); return; }
    if (e.target.closest('a,button,[role=button],summary,label')) { e.preventDefault(); e.stopPropagation(); }
    deactivate();
  }, true);
  ['submit', 'dblclick'].forEach(t => document.addEventListener(t, e => { if (mode === 'edit' && bar && !e.target.closest('#ed-bar,#ed-login')) { e.preventDefault(); e.stopPropagation(); } }, true));

  document.addEventListener('keydown', e => {
    if (!active) return;
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); deactivate(); }
  }, true);
  document.addEventListener('input', () => { if (active) refresh(); }, true);
  document.addEventListener('paste', e => {
    if (!active) return; e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\s*\n\s*/g, ' ');
    document.execCommand('insertText', false, text);
  }, true);
  window.addEventListener('beforeunload', e => { if (bar && dirtyCount()) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- images ---------- */
  function pickImage(img) {
    const src = img.dataset.edOrig || img.getAttribute('src') || '';
    if (!/^img\//.test(src)) { toast('This image can’t be swapped here. Ask Claude to change it.'); return; }
    const input = $el('input', { type: 'file', accept: 'image/*' });
    input.onchange = async () => {
      const f = input.files[0]; if (!f) return;
      try {
        const data = await shrink(f);
        img.dataset.edOrig = src;
        const ex = images.find(x => x.oldSrc === src); if (ex) ex.data = data; else images.push({ oldSrc: src, name: f.name, data });
        document.querySelectorAll('img').forEach(i => { if ((i.dataset.edOrig || i.getAttribute('src')) === src) { i.dataset.edOrig = src; i.src = 'data:image/jpeg;base64,' + data; } });
        refresh(); toast('Image swapped. Hit Save to publish it.');
      } catch { toast('Couldn’t read that image. Try a JPG or PNG.'); }
    };
    input.click();
  }
  function shrink(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const max = 2000, k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      im.onerror = rej; im.src = url;
    });
  }

  /* ---------- save ---------- */
  async function save() {
    deactivate();
    const ch = allChanges(), broken = ch.filter(c => c.broken);
    let edits = ch.filter(c => !c.broken).map(({ old, new: n }) => ({ old, new: n }));
    if (!edits.length && !images.length) { toast(broken.length ? 'That change couldn’t be saved. Undo it and ask Claude instead.' : 'Nothing to save.'); return; }
    saveBtn.disabled = true; toast('Saving…', 0);
    try {
      let r = await call({ action: 'save', edits, images: images.map(({ oldSrc, name, data }) => ({ oldSrc, name, data })) });
      const multi = r.results.filter(x => x.status === 'multiple');
      const again = multi.filter(x => confirm(`“${short(x.old)}” appears in ${x.count} places on the site.\n\nChange all of them to “${short(x.new)}”?`));
      if (again.length) {
        const r2 = await call({ action: 'save', edits: again.map(x => ({ old: x.old, new: x.new, all: true })) });
        r.results = r.results.filter(x => !again.includes(x)).concat(r2.results);
      }
      const missed = r.results.filter(x => x.status === 'notfound' || x.status === 'multiple');
      // Reset tracking for what went through.
      tracked.clear(); images.length = 0;
      document.querySelectorAll('[data-ed-changed]').forEach(e => e.removeAttribute('data-ed-changed'));
      refresh();
      const lines = ['Saved. Changes go live in about a minute (refresh the public site to see them).'];
      if (missed.length) lines.push(`Not saved (${missed.length}): ${missed.map(x => '“' + short(x.old) + '”').join(', ')}. Ask Claude to change ${missed.length > 1 ? 'these' : 'this'}.`);
      if (broken.length) lines.push('One edit removed formatting and wasn’t saved. Ask Claude to change it.');
      toast(lines.join(' '), missed.length || broken.length ? 0 : 7000);
    } catch (x) {
      if (x.status === 401) { store.set('ed-pw', ''); toast('Your password was rejected. Reload the page to log in again.', 0); }
      else toast('Save failed: ' + x.message + ' Your changes are still here, so try again.', 0);
      refresh();
    }
  }
  const short = s => (s.length > 60 ? s.slice(0, 57) + '…' : s);

  /* ---------- boot ---------- */
  function boot() {
    const saved = store.get('ed-pw');
    if (saved) { pw = saved; call({ action: 'check' }).then(start).catch(() => { store.set('ed-pw', ''); login(); }); }
    else login();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
