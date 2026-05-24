# Handoff — Argus Demo Polish + Vercel Fix

You are picking up an Argus (PDF fact-check auditor) session from another Claude instance.
Repo: `/Users/luochaoqi/dev/MiroMind-Deep-Research`. Stack: FastAPI/Python backend, Next.js 16 frontend.

## What just happened

The previous session replaced the toy `examples/sample-report.pdf` demo with a real,
MiroMind-audited 9-page CBO public-domain PDF that has 10 deliberately seeded errors
(fabricated citations, misaligned quotes, stale data, internal contradictions). The real
MiroMind audit caught 3 of the 10 plants with confidence >= 0.90:

- **Sokolov & Reyes (2023)** fake academic citation → `fabricated 0.90`
- **$7,428B outlays table** contradicting `$7.0T` narrative → `fabricated 0.90`
- **"Legislation enacted through November 15, 2024"** backdated → `stale 0.96`

Along the way 3 real production bugs surfaced and were fixed:
1. `_RawClaim.extracted_metadata` rejected `""` (LLM sometimes emits empty string)
2. `_RawClaim.span` rejected mixed-type lists (json-repair merges fields when LLM drops a comma)
3. `_per_claim_specialist.run_for_claim` only caught `JsonRepairFailed` → any other exception
   killed sibling agents and wiped all in-memory findings (lost $16 of audit work once)

All committed in `42b00a5` (HEAD, ahead of `origin/master` by 2 commits — `27f9a0f` BYOK fix also pending push).

## **YOUR FIRST TASK: Vercel deployment failed**

User just reported the latest Vercel deploy failed. **Get the error first, then fix.**

Ask user to paste the Vercel Build Logs error. Common causes (in order of likelihood):
1. JSON parse error in `web/public/sample-findings.json` (newly rewritten — 23KB, 3 claims/5 findings/25 evidences)
2. TypeScript error from `web/lib/types.ts` schema mismatch with new sample
3. Build OOM on the large `web/public/sample-report.pdf` (1.3MB)
4. `pnpm install` lockfile drift

**Fast diagnosis sequence:**
```bash
cd /Users/luochaoqi/dev/MiroMind-Deep-Research
# 1. Validate JSON
uv run python -c "import json; json.load(open('web/public/sample-findings.json'))"
# 2. Local build mirrors Vercel
pnpm --filter ./web build
# 3. Local tests
pnpm --filter ./web test
```

If user hasn't pushed yet (`git status` shows "ahead of origin/master by 2 commits"), the failed
Vercel deploy is from a PREVIOUS push, not these changes — different bug.

## What's NOT in the repo (intentionally)

`/tmp/argus-demo/` has all the scratch work — don't commit any of it:
- `cbo-outlook-2025-original.pdf` — the unmodified CBO source (1.9MB)
- `patch_plants.py` — script that applies 10 plants to original
- `PLANTS_MANIFEST.json` — audit-trail "cheat sheet" of what's planted where
- `recover.py` — script that pulled the failed 6th-audit findings back from MiroMind history
- `findings.json` — the full 27-finding recovered audit (we curated 5 of these into the demo)
- `RECOVERY_REPORT.md` — scoring of audit vs manifest

## Important context

- **User's MiroMind credits ran dry** (HTTP 402 at end of 6th audit). They burned ~$20 total
  across 6 attempts. **Do NOT run `argus audit` against the live API** unless they top up and
  explicitly authorize.
- **Session cost is HIGH** ($2100+ Anthropic tokens in previous session). User is cost-sensitive.
  Don't burn tokens on speculative work. Get the Vercel error, fix it, push, done.
- **Sandbox blocks `git push`** — the user must run `git push origin master` themselves.
- **GateGuard hook is active**: before every Bash/Edit/Write call you must present 4 facts
  (importers / public surface / data I/O / verbatim user instruction) in the same response that
  invokes the tool. Otherwise the hook blocks.
- **Live deployments**:
  - Frontend: `https://argus-truth-engine.vercel.app/`
  - Backend: `https://argus-truth.fly.dev/healthz` (BYOK — visitor pastes their own MiroMind key)
- **Hackathon submission link** = the Vercel URL above. Getting Vercel green is the only
  blocker between now and submission.

## Files changed in commit 42b00a5

```
src/argus/agents/planner.py     +27 -0   (2 new field_validators)
src/argus/orchestrator.py       +17 -1   (broader exception handling in run_for_claim)
web/public/sample-findings.json +/-      (replaced toy with real CBO audit, 3 claims / 5 findings)
web/public/sample-report.pdf    +/-      (replaced toy with real 9-page CBO PDF, 1.3MB)
examples/cbo-outlook-2025-demo.pdf  NEW  (patched CBO PDF, same as sample-report.pdf)
```

## Suggested workflow

1. **Acknowledge handoff** — confirm with user you understand the state.
2. **Get Vercel error** — ask user to paste Build Logs error text/screenshot.
3. **Diagnose locally** — reproduce with `pnpm --filter ./web build` before guessing.
4. **Fix surgically** — one-file change ideally. Match existing code style.
5. **Local verify** — re-run build + tests.
6. **Commit** — separate commit, clear message.
7. **Tell user to `git push origin master`** (sandbox blocks you).

## Do NOT

- Run `argus audit` (burns MiroMind credits — user is out)
- Re-do the demo PDF (it's done; the curated `sample-findings.json` is intentional)
- Touch `.github/` (out of scope, leftover from earlier work)
- Re-architect orchestrator persistence (real bug, but a separate TODO — there's an architectural
  flaw where top-level graph exceptions wipe all in-memory state; user knows; not for this session)

Good luck. Keep it tight.
