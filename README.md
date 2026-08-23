# Text Art

**Turn a picture into letters. No AI.**

Reddit Devvit app that turns any picture into letters and types it live on a **9:16** canvas. Users can copy the text or share a still to Reddit’s media CDN.

---

## Features

| Feature | Detail |
|--------|--------|
| Device or link → text art | Client-side canvas sampling (line-art + photo) |
| Live draw | Typewriter animation (responsive preview) |
| Save / share still | JPEG of the text art; `r/ketchkeys` on text art only |
| Save video | Local typewriter video with `audio/demo.mpeg` (~82s) |
| Auto community post | Playable draw card first, then picture + text art, as you |
| Copy text | Full letter string |
| Stats | Redis community + per-user counters |

---

## Project structure

```
├── brand/                 # Subreddit icon + banner (not shipped in app)
│   ├── icon.png
│   └── banner.png
├── devvit.json            # Entrypoints, permissions, playtest sub
├── src/
│   ├── client/            # React UI (splash + converter)
│   │   ├── styles/        # Design system CSS
│   │   ├── hooks/
│   │   ├── lib/           # image→ASCII + canvas animation
│   │   ├── game.*         # Expanded converter entry
│   │   └── splash.*       # Inline feed card entry
│   ├── server/            # Hono API (Redis, media, posts)
│   │   ├── core/
│   │   └── routes/
│   └── shared/            # Types, config, pure ASCII engine
├── package.json
└── vite.config.ts
```

---

## Requirements

- **Node.js 22.20+**
- Reddit developer account: [developers.reddit.com](https://developers.reddit.com/new)

---

## Commands

```bash
npm install
npm run login          # Devvit login
npm run dev            # Playtest on r/ketchkeys
npm run check          # types + lint + unit + build
npm run deploy         # check + upload
npm run launch         # upload + publish for review
```

| Script | Purpose |
|--------|---------|
| `dev` | Live playtest |
| `check` | Full quality gate before ship |
| `deploy` | Upload to Devvit |
| `launch` | Submit for Reddit review |

---

## Publish checklist

1. `npm run check` — must pass.
2. `npm run dev` — verify on **r/ketchkeys**:
   - From device + from link
   - Draw → skip → copy → download
   - Auto-post pictures, then the playable draw card
   - Watermark on text art only
3. Upload `brand/icon.png` + `brand/banner.png` in subreddit Mod Tools (optional).
4. Fill Devvit app listing (name, description, screenshots). State clearly that
   every conversion is **auto-posted as the signed-in user** to the community.
5. `npm run launch` — submit for review.
6. After approval, install on public subs.

---

## Permissions (`devvit.json`)

- **media** — share / community stills to Reddit CDN
- **redis** — conversion counters
- **http** — fetch rehosted media when resolving image links
- **reddit** (`SUBMIT_POST` as user) — conversion posts on the signed-in account

---

## UI

Dark modern layout (Tailwind): soft panels, rounded controls, Reddit orange CTAs.  
Shared sizes/limits live in `src/shared/config.ts`.

---

## License

BSD-3-Clause
