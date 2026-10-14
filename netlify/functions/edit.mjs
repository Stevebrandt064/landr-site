// Save endpoint for landr.com.au/edit.
// Env vars (Netlify → Project configuration → Environment variables):
//   EDIT_PASSWORD  – the password for the edit page
//   GITHUB_TOKEN   – fine-grained token with Contents: read & write on Stevebrandt064/landr-site
import { applyEdits } from './lib/apply.mjs';
import { timingSafeEqual } from 'node:crypto';

const REPO = 'Stevebrandt064/landr-site', BRANCH = 'main', FILE = 'index.html';
const API = `https://api.github.com/repos/${REPO}/contents/`;
// Accept the setting name in any case (e.g. edit_password or EDIT_PASSWORD).
const env = k => {
  const v = (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];
  if (v) return v.trim();
  const alt = Object.keys(process.env).find(x => x.toLowerCase() === k.toLowerCase());
  return alt ? String(process.env[alt]).trim() : (globalThis.Netlify?.env?.get?.(k.toLowerCase()) || '').trim() || undefined;
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function passwordOk(given) {
  const want = env('EDIT_PASSWORD') || '';
  const a = Buffer.from(String(given || '')), b = Buffer.from(want);
  return want.length >= 8 && a.length === b.length && timingSafeEqual(a, b);
}

async function gh(path, opts = {}) {
  const r = await fetch(API + path + (opts.method ? '' : `?ref=${BRANCH}`), {
    ...opts,
    headers: { authorization: `Bearer ${env('GITHUB_TOKEN')}`, accept: 'application/vnd.github+json', 'user-agent': 'landr-editor', ...(opts.headers || {}) }
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function getIndex() {
  const { status, body } = await gh(FILE);
  if (status !== 200) throw new Error(`Couldn't read the site from GitHub (${status}).`);
  return { src: Buffer.from(body.content, 'base64').toString('utf8'), sha: body.sha };
}

async function putFile(path, contentB64, message, sha) {
  return gh(path, { method: 'PUT', body: JSON.stringify({ message, content: contentB64, branch: BRANCH, ...(sha ? { sha } : {}) }) });
}

const safeName = n => String(n || 'image').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  let p; try { p = await req.json(); } catch { return json(400, { error: 'Bad request' }); }
  const missing = ['EDIT_PASSWORD', 'GITHUB_TOKEN'].filter(k => !env(k));
  if (missing.length) {
    const seen = Object.keys(process.env).filter(k => /pass|token|git|edit/i.test(k) && !/^(NETLIFY|AWS|LAMBDA|_)/.test(k));
    return json(500, { error: `Editing isn’t set up yet. Netlify can’t see: ${missing.join(', ')}.` + (seen.length ? ` It can see: ${seen.join(', ')}.` : '') + ' Check the spelling, then redeploy.' });
  }
  if ((env('EDIT_PASSWORD') || '').length < 8) return json(500, { error: 'EDIT_PASSWORD must be at least 8 characters.' });
  if (!passwordOk(p.password)) { await new Promise(r => setTimeout(r, 800)); return json(401, { error: 'Wrong password.' }); }
  if (p.action === 'check') return json(200, { ok: true });
  if (p.action !== 'save') return json(400, { error: 'Unknown action' });

  const edits = Array.isArray(p.edits) ? p.edits.slice(0, 200) : [];
  const images = Array.isArray(p.images) ? p.images.slice(0, 10) : [];
  try {
    // 1. Upload any new images.
    for (const im of images) {
      if (!/^img\//.test(im.oldSrc || '') || !/^[A-Za-z0-9+/=]+$/.test(im.data || '')) continue;
      if (im.data.length > 6_000_000) return json(413, { error: 'That image is too large.' });
      const path = `img/uploads/${Date.now()}-${safeName(im.name)}.jpg`;
      const r = await putFile(path, im.data, `Upload image ${path} via site editor`);
      if (r.status !== 201 && r.status !== 200) return json(502, { error: `Image upload failed (${r.status}).` });
      edits.push({ old: im.oldSrc, new: path, all: true, image: true }); // same image file → replace everywhere it's used
    }
    // 2. Apply text edits and commit index.html (retry once if someone saved at the same moment).
    for (let attempt = 0; attempt < 2; attempt++) {
      const { src, sha } = await getIndex();
      const { src: out, results } = applyEdits(src, edits);
      if (out === src) return json(200, { ok: true, committed: false, results });
      const r = await putFile(FILE, Buffer.from(out, 'utf8').toString('base64'), `Site edits via landr.com.au/edit (${results.filter(x => x.status === 'ok').length} change(s))`, sha);
      if (r.status === 200 || r.status === 201) return json(200, { ok: true, committed: true, results });
      if (r.status !== 409 && r.status !== 422) return json(502, { error: `Save failed (${r.status}).` });
    }
    return json(409, { error: 'Someone else saved at the same moment. Try again.' });
  } catch (e) {
    return json(500, { error: e.message || 'Save failed.' });
  }
};
