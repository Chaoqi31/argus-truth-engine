You are producing one candidate design in an architect arena for the Argus backend.

Read these files first, in full:

1. /Users/chaoqi/.claude/plugins/cache/open-pstack/pstack/1.4.0/skills/architect/SKILL.md (the workflow you are inside)
2. /Users/chaoqi/.claude/plugins/cache/open-pstack/pstack/1.4.0/skills/architect/references/runner-prompt.md (your discipline)
3. /Users/chaoqi/.claude/plugins/cache/open-pstack/pstack/1.4.0/skills/architect/references/rationale-template.md (shape of your rationale)
4. /Users/chaoqi/.claude/plugins/cache/open-pstack/pstack/1.4.0/skills/architect/references/design-red-flags.md (screen your design against it)
5. /tmp/arena-argus/grounding.md (the problem, the current system, verified defects, constraints, and the design question)

Then read whatever you need of the codebase at
/Users/chaoqi/Dev/argus-truth-engine/.claude/worktrees/architecture-refactor
(start with src/argus, tests/golden.py, tests/fake_llm.py, and
web/app/audit/hooks/use-audit-run.ts for the event consumer). That checkout is
READ ONLY for you. Do not edit, create, or delete anything in it, and do not
run git commands that change it.

Your task: design the target architecture of the Argus backend (src/argus)
as if written today for the requirements in the grounding doc, and how the web
app gets its types and consumes the event stream. Answer every numbered part
of "The design question". Decide whether LangGraph stays; justify it either way.

Write your outputs ONLY under your output directory (given at the end):

- `rationale.md`: one to three pages shaped per rationale-template.md. Leave
  the "Synthesis decision" section as a placeholder line. Include a section
  "Defects fixed by construction" that maps each of the nine verified
  problems in the grounding doc to the part of your design that removes it.
  Include a section "Delivery sequence": the ordered list of small,
  independently verifiable commits you would land, each keeping the golden
  harness green or changing it deliberately, riskiest first.
- `sketch/`: a Python package sketch of the new `src/argus` module map. Real
  type definitions (Pydantic models, dataclasses, enums, protocols where they
  earn their place), full function and method signatures with docstrings
  stating intent and invariants, bodies `raise NotImplementedError` or short
  pseudocode comments for tricky logic. Show the caller's usage first: a
  `sketch/USAGE.md` with the call sites for the CLI, the job runner, and the
  WebSocket route, written before the types.
- If your design touches the web event consumer, add `sketch/web/` with the
  TypeScript shape of the event handling (types plus signatures only).

Constraints on your design, from the repository owner:
- No backward compatibility, no data migrations, no compatibility shims.
- Simplest design that fully meets the current requirements. No speculative
  abstraction (no interface with one implementation, no config for values
  that never change). Prefer established, well-maintained libraries when they
  reduce overall complexity. Keep modules organized around domain knowledge,
  not execution order.

Be decisive. You are one of two runners on different models; differences
between candidates are the signal. Do not hedge toward a middle.

When you finish, reply with a short summary: the three most load-bearing
decisions, and the list of files you wrote.
