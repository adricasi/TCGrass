# 0003. Call Gemma through one env-configured OpenAI-compatible endpoint

- Status: Accepted (2026-10-08)
- Date: 2026-10-07
- Deciders: adricasi

## Context
Identification needs a vision-capable Gemma model (REQ-003). It is not yet known which serving
path works on DigitalOcean (product.md Q-7): DO serverless inference, vLLM on a GPU Droplet,
or Ollama on a laptop as fallback. REQ-012 requires switching endpoints by configuration, and
the post wants a "swap the model" demo.

## Options considered
1. **One OpenAI-compatible chat-completions client** (base URL, model, optional API key from
   env), image sent as a base64 data URL, response forced to JSON. Pros: all three paths speak
   this API; one code path; trivial fake in tests. Cons: structured-output support differs
   per server, so we must validate the JSON ourselves.
2. **One adapter per provider** (DO SDK, vLLM, Ollama native API). Pros: use each server's
   best features. Cons: three code paths to build and test in 8 h.

## Decision
We will use a single OpenAI-compatible client configured by `INFERENCE_BASE_URL`,
`INFERENCE_MODEL` and optional `INFERENCE_API_KEY`, request JSON output where the server
supports it, and always validate the response with a zod schema restricted to the catalogue
ids (AC-003.8), because it covers every candidate path with one tested implementation.

## Consequences
- Positive: the spike decides the path without code changes; Ollama works for local dev.
- Negative / risks: some servers ignore `response_format`; mitigated by schema validation
  and treating invalid output as "none". Prompt includes the full catalogue (15 cards, small).
- Follow-ups: record the chosen path and model id in design.md after the spike.
