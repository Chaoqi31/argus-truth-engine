# Arena rubric (the picker's tool; candidates never saw it)

Score each criterion 1 to 5 with one line of evidence (file:line in the candidate).

1. Defect coverage. Each of the nine verified problems in grounding.md is removed
   by construction (a type, a single owner, a structure), not patched with a flag.
2. Reader load. Tracing "what happens to one claim from upload to finding" touches
   at most three modules. No pass-through layers. One source of truth for job
   status, stage records, and event sequence numbers.
3. Interface depth. Small public surfaces (pipeline entry, job store, event log,
   LLM clients) that hide substantial behavior. No ORM, wire, or transport types
   crossing into domain code.
4. Subtraction. Dependencies and modules removed versus added. No protocol with
   one implementation, no configuration for values that never change, no
   speculative extension points.
5. Deliverability. The delivery sequence is a list of small commits, each
   verifiable against the golden harness, riskiest first, with a concrete first
   step.
6. Web contract. Typed event protocol and generated web types; the web client
   needs no per-agent special cases to render the live trace.
