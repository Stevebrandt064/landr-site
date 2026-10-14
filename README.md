# landr.com.au

Static site for Landr. Hosted on Netlify; every push to `main` publishes automatically.

## Structure
- `index.html`: the whole site (pages, styles, script)
- `img/`: images, logos and videos

## Forms
All seven forms submit to Netlify Forms under six form names: `subscriptions`, `enquiries`, `questionnaires`, `pitches`, `investorEnquiries`, `bookRequests`.
Submissions appear in Netlify → Site → Forms. Turn on email alerts under Forms → Form notifications.

## Flight log posts
Add a post to the top of the `FEED` list in `index.html` (search for `const FEED=`):

```js
{author:'SB', kind:'update', title:'Headline', body:'Post text', link:'https://…', ts:Date.parse('2026-10-14')}
```

Authors: `SB` (Stephen Brandt) or `TB` (Trent Butler). Kinds: `win`, `update`, `learning`.

## Editing
**Steve/Trent:** go to landr.com.au/edit, log in, click text or images, hit Save. Live in ~1 minute.
Each save is a commit to `main` ("Site edits via landr.com.au/edit").

**Claude:** always `git pull` before editing, since site-editor saves commit straight to `main`.

Editor files: `edit.js` (on-page editor, loads only on /edit), `netlify/functions/edit.mjs` (save endpoint),
`netlify/functions/lib/apply.mjs` (safe text/image replacement in index.html).
Netlify env vars required: `EDIT_PASSWORD`, `GITHUB_TOKEN` (fine-grained, Contents read/write on this repo only).
