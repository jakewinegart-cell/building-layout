# wizard-v1: content for the in-app "Ask the wizard" chat box

- wizard-spec.md: full spec. Covers the architecture (LLM tool call + deterministic validation), real and proposed model fields, the intent catalog, slots, clarifications, preview/apply/undo, validations (pier rule, IRC R905 min slopes, headers, studs) and the worked example for "10 ft to 8 ft" on the 20x16.
- wizard-commands.json: machine-readable intents (examples, slots, model fields touched, validations, ops), LLM tool schemas, validation rules and cited code_facts.
- wizard-tests.json: 24 test phrases with the expected tool, intent, slots, clarification, model change and validations.
- reference/shed-roof-example.mjs: `node reference/shed-roof-example.mjs` recomputes the worked-example numbers.

All $ are EXAMPLE (content-v3 Home Depot online snapshot 2026-10-28, not Denver). Shed roofs need App Builder to add shedGeometry before the wizard can apply them.
