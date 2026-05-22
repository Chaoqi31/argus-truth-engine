# Deploying Argus

End-to-end recipe for shipping Argus as a public BYOK demo. The frontend
goes on Vercel; the backend goes on Fly.io. Visitors paste their own
MiroMind API key, so the operator's credits are never burned.

Total cost: **$0/mo** on free tiers (Fly hobby + Vercel hobby), assuming
modest traffic.

---

## 0. Prerequisites

```bash
# macOS (this repo)
brew install flyctl
npm i -g vercel              # only if you prefer CLI deploys
```

You need:
- A **Fly.io** account (https://fly.io/app/sign-up) — credit card required
  but the hobby tier is free.
- A **Vercel** account (https://vercel.com/signup) — GitHub OAuth is fine.
- The repo pushed to GitHub on `master` at or past commit `d8a451d`.

---

## 1. Backend → Fly.io

### 1a. Authenticate
```bash
flyctl auth login            # opens browser
```

### 1b. Launch the app (uses fly.toml in this repo)
```bash
flyctl launch --no-deploy --copy-config --name argus-api
#                                              ^^^ pick anything unique
```
When prompted:
- Region: pick the one closest to you (we default `sin` = Singapore).
- Postgres / Redis: **No** to both (we use in-memory by default).
- Deploy now: **No** (we still need to create the volume).

### 1c. Create the persistent volume for uploaded PDFs
```bash
flyctl volumes create argus_data --region sin --size 1
```

### 1d. Set runtime config (after Vercel is deployed, come back and set CORS)
```bash
flyctl secrets set \
  ARGUS_CORS_ALLOW_ORIGINS="https://your-vercel-app.vercel.app"
# Leave ARGUS_MIROMIND_API_KEY UNSET — that's the whole point of BYOK.
```

### 1e. Deploy
```bash
flyctl deploy --remote-only
flyctl status                # confirm 1 machine running, healthcheck passing
flyctl logs                  # tail logs while you smoke-test
```

Backend URL will be `https://argus-api.fly.dev` (or whatever name you chose).
Test it: `curl https://argus-api.fly.dev/healthz` → `{"status":"ok"}`.

---

## 2. Frontend → Vercel

### 2a. Import the repo
1. Visit https://vercel.com/new
2. Import the GitHub repo
3. **Root Directory**: `web`
4. Framework preset auto-detects Next.js 16.

### 2b. Environment variables (Settings → Environment Variables)
| Name | Value | Notes |
|---|---|---|
| `ARGUS_API_HOST` | `https://argus-api.fly.dev` | The HTTP rewrite target. |
| `NEXT_PUBLIC_ARGUS_WS_HOST` | `argus-api.fly.dev` | Host only, no scheme/port. Used for the WebSocket. |

### 2c. Deploy
Click **Deploy**. Vercel will assign `https://<project>-<hash>.vercel.app`.

### 2d. Back to Fly: update CORS
```bash
flyctl secrets set \
  ARGUS_CORS_ALLOW_ORIGINS="https://your-actual-vercel-url.vercel.app"
# Fly will restart the machine automatically.
```

---

## 3. Smoke test the public deploy

1. Open your Vercel URL.
2. Click **…or try the sample audit** — should render the bundled demo
   instantly (no backend call).
3. Paste your MiroMind API key in the BYOK input.
4. Upload `examples/sample-report.pdf` from this repo.
5. Watch the live trace stream in. Findings should appear over 5-15 minutes.
6. Verify `/audit/some-fake-id` shows "Audit failed — No audit with id …"
   instead of spinning forever.

---

## 4. Custom domain (optional)

### Vercel
Settings → Domains → add your domain → follow the DNS instructions.

### Fly.io
```bash
flyctl certs create api.yourdomain.com
# Add the CNAME flyctl prints to your DNS provider.
```
Then update Vercel's `ARGUS_API_HOST` + `NEXT_PUBLIC_ARGUS_WS_HOST` to the
new domain and redeploy the frontend.

---

## 5. Day-2 operations

```bash
# Stream logs
flyctl logs

# Restart the app (e.g. after changing secrets)
flyctl machine restart

# Scale up if you get traffic
flyctl scale count 2 --max-per-region 2
flyctl scale memory 1024

# Take it down
flyctl apps destroy argus-api
```

---

## Cost ceiling

- **Fly.io** hobby tier: 3 shared-cpu-1x VMs + 3GB volume + 160GB transfer
  free. Argus uses 1 VM + 1GB volume.
- **Vercel** hobby: 100GB bandwidth, no commercial use clause as long as
  the demo isn't behind a paywall.
- **MiroMind**: $0 to the operator under BYOK — each visitor pays from
  their own MiroMind balance.

The only way this deploy starts costing money is if you turn off BYOK and
expose `ARGUS_MIROMIND_API_KEY`. Don't do that for a public URL.
