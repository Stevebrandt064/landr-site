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
Ask Claude, or edit `index.html` in GitHub's web editor (pencil icon) and commit.
