# Examples

A small PDF used to demonstrate `argus audit`.

`sample-report.pdf` is a 4-page synthetic document with two fictional
citations ("Smith (2021)" and "Doe et al., 2019") — neither corresponds
to a real published work, so the Citation Verifier should label both as
fabricated.

## Run

```bash
export ARGUS_MIROMIND_API_KEY=sk_…
uv run argus audit examples/sample-report.pdf -o examples/findings.json
```

The resulting `findings.json` (gitignored) contains every Claim the
Planner extracted, every Finding the Citation Verifier produced, and
the complete ReasoningTrace — every `thinking`, `web_search`,
`fetch_url_content`, `execute_python` step emitted by MiroMind.
