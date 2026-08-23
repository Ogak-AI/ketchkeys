You are writing a Devvit web application (**Text Art**) that runs on Reddit.com.

## Product

- Convert user pictures to letter / text art (no AI — pixel brightness mapping). Never say “ASCII” in user-facing copy; people do not know that word. Use “text art” or “letters”.
- Animate the draw on a **9:16** canvas (preview half-res). Posted stills follow the picture aspect (width 600–800, height capped at 1280) so photos are not letterboxed into a tall black frame.
- Auto-post a playable typewriter-draw card as the signed-in user, plus the picture stills. Users can save a local video of the draw; length matches `audio/demo.mpeg` (~82s) and uses that track as the soundtrack.

## Tech Stack

- **Frontend**: React 19, Tailwind CSS 4, Vite
- **Backend**: Node.js v22 serverless (Devvit), Hono
- **Shared**: `src/shared/` — pure ASCII engine, API types, config

## Layout

```
src/server   — Hono routes (/api/*, /internal/*)
src/client   — iframe UI (splash + game)
src/shared   — ascii.ts, api.ts, config.ts
brand/       — community icon/banner (not in web bundle)
```

- `splash.html` / `splash.tsx` — inline feed card
- `game.html` / `game.tsx` — expanded converter
- Design tokens: `src/client/styles/index.css`

## Rules

- Use `navigateTo` / `showToast` / `showForm` / `requestExpandedMode` from `@devvit/web/client`.
- Do not use Blocks / `@devvit/public-api`.
- New menu endpoints must be registered in `devvit.json`.
- Client cannot call arbitrary external domains (CSP). Image conversion is local via canvas.
- Prefer shared constants from `src/shared/config.ts` over magic numbers.

Docs: https://developers.reddit.com/docs/llms.txt
