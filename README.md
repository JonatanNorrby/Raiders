# Raiders

Minimal two-player browser card battler built for Cloudflare Workers.

## Prototype

- Build and save reusable decks in the browser.
- Start a game to create a lobby and share its six-character code.
- Join an existing lobby with that code.
- Both players choose a saved deck and press Ready.
- The match starts automatically when both players are ready.
- The server is authoritative for health, armor, mana, turns, draws and card effects.

The first prototype contains one character (**Raider**) and three cards. Decks are stored in `localStorage` for now so they can be reused across games on the same browser. Account-backed deck storage can be added later without changing the match protocol.

## Architecture

- `public/` — framework-free HTML/CSS/JS client and future art assets.
- `src/worker.js` — HTTP API and routing into match rooms.
- `src/game-room.js` — one Durable Object per game code; owns lobby and match state.
- `src/game-data.js` — server-side card/character catalog and deck rules.
- `wrangler.jsonc` — Cloudflare Worker, static assets and Durable Object configuration.

No frontend framework, database service or separate WebSocket server is required.

## Local development

```bash
npm install
npm run dev
```

Open the URL printed by Wrangler. Use two browser windows to test a two-player match.

## Deploy

```bash
npm install
npm run deploy
```

If the repository is connected to Cloudflare Workers Builds, pushes to the production branch can deploy automatically. The Cloudflare Worker project name must match `raiders` from `wrangler.jsonc`.

## Assets

See `public/assets/README.md` and the README inside every asset subfolder. The game has CSS fallbacks, so it works before any PNG files are added.
