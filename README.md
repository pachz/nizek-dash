# Nizek+

Combined Kanban across Nizek Project Manager boards. Vite + React + Convex.

## Local

```bash
npm install
npx convex dev          # writes VITE_CONVEX_URL to .env.local
npm run dev:frontend    # http://127.0.0.1:5173
```

Or `npm run dev` for frontend + Convex together. Use `npm run dev:backend:anonymous` only for an offline anonymous backend.

## Deploy to Vercel

1. Create a Convex project and **production** deployment at [dashboard.convex.dev](https://dashboard.convex.dev).
2. Deployment Settings → **Generate Production Deploy Key** (`deployment:deploy`).
3. Import this repo in [vercel.com/new](https://vercel.com/new).
4. Add env var **`CONVEX_DEPLOY_KEY`** = that key (Production only).
5. Deploy. `vercel.json` already sets:
   - Build: `npx convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'npm run build'`
   - Output: `dist`
   - SPA rewrite to `index.html`

### Preview deployments (optional)

Add a second `CONVEX_DEPLOY_KEY` from Convex **Preview Deploy Key**, scoped to Preview only in Vercel.

### After first deploy

Open the app → **Session** → paste your `panel.nizek.com` Cookie header → **Sync now**. Or **Load seed export** for the bundled snapshot.
