# 0006. Run production inference on DigitalOcean serverless Gemma, pay per use, with daily call caps

- Status: Accepted (2026-10-10, after the DO check; latency accepted by the author, NFR-004 revised)
- Date: 2026-10-10
- Deciders: adricasi

## Context
The author wants TCGrass to stay online as a public product after the challenge (product.md
G-7, added 2026-10-10), not only for the Sunday field test. ADR 0003 makes the inference
endpoint a configuration choice; this ADR decides which endpoint production uses (product.md
Q-7).

Facts gathered on 2026-10-10:
- **DO serverless inference** lists Google's Gemma 4 (`gemma-4-31B-it`) at **$0.18 per 1M
  input tokens and $0.50 per 1M output tokens**, prepaid only ([DO inference pricing], "last
  verified 9 Oct 2026"). DO's model list does **not** say whether Gemma 4 accepts images,
  although it labels other models as vision models ([DO supported models]). DO's status page
  logged a Gemma 4 latency/timeout incident in July 2026.
- **DO GPU Droplets**: RTX 4000 Ada (20 GB) **$0.76/hour**, L40S **$1.57/hour**, H100
  **$4.41/hour**, and "when you power off your GPU Droplet, you are still billed for it"
  ([DO GPU Droplet pricing]).
- **Laptop Ollama** with `gemma4:e4b` scored 18/18 in the T-001 spike, but with p95 14.8 s
  against the 8 s target (NFR-004), and the laptop must stay on.
- One capture uses about 1,500 input tokens (prompt + image) and about 80 output tokens, so
  about **$0.0003 per capture** on DO serverless (estimate, to be confirmed with the
  `usage` figures the endpoint returns).
- Pay-per-use means anyone who can create players can spend our money: players can be
  created 10/hour per IP (AC-002.8) and each can capture 10 photos/minute (AC-003.11).

Monthly cost, always on (the app Droplet + Volume, about $7–13/month, come on top of each):

| Captures / month | DO serverless | GPU Droplet (RTX 4000 Ada, 730 h) | Laptop Ollama |
|---|---|---|---|
| 0 (idle) | $0 | ≈ $555 | $0, but not viable for the public |
| 10,000 | ≈ $3 | ≈ $555 | — |
| 100,000 | ≈ $30 | ≈ $555 | — |

The GPU Droplet only breaks even above roughly 1.8 million captures a month.

**DO check result (2026-10-10, T-018):** DO serverless `gemma-4-31B-it`, 19 spike photos (2026-10-10): 89 % correct (17/19; 12/13 catalogue, 3/3 none, 2/3 screens — the miss became `none`, nothing minted), 100 % parseable, 1 timeout, latency p50 9.1 s / p95 26.4 s; flavor lines clean. Images are accepted and quality passes; p95 misses the old 8 s target, which the author accepted (typical wait ≈ 9 s), so NFR-004 became p50 ≤ 10 s, p95 ≤ 30 s.

## Options considered
1. **DO serverless Gemma 4, pay per use.** Pros: no idle cost, no GPU to operate or destroy,
   scales with use, stays on DigitalOcean (ADR 0002). Cons: photos go to a third party
   (privacy notice must cite DO's terms, Q-9); vision support and quality on our cards are
   unverified; a larger model than the one we tested; provider incidents affect us.
2. **Always-on GPU Droplet with vLLM.** Pros: fully private (G-3), the model we validated,
   predictable latency. Cons: ≈ $555/month whether anyone plays or not; we operate it.
3. **Laptop Ollama through an SSH tunnel.** Pros: free, validated. Cons: misses NFR-004, the
   service is down whenever the laptop is; unacceptable for a public product.
4. **Another pay-per-use provider's Gemma** (some list Gemma 4 31B at about $0.13/$0.37 per
   1M tokens). Pros: cheaper per token. Cons: leaves the DigitalOcean prize track for a
   core component; another data processor to cite.

## Decision
We will run production inference on **DigitalOcean serverless Gemma 4**, paid per use, and
protect the budget with **hard daily caps on model calls** (NFR-012): 3,000 calls per UTC day
overall (AC-003.13, ≈ $1/day at today's prices) and 30 per player (AC-003.14), so one abuser
can't use up everyone's allowance. Past a cap, captures answer with the time they resume,
without calling the model. Because idle cost is zero and expected use is far below
the GPU break-even, this is the only option that keeps a public service affordable.

Fallback order if DO's Gemma 4 fails the check below: (a) another vision model on DO serverless,
(b) another provider's pay-per-use Gemma vision endpoint (option 4), each with a re-run of the
spike. A GPU Droplet (option 2) is only for short, private bursts such as a field test, and is
destroyed afterwards (NFR-006). If no pay-per-use vision endpoint passes, G-7 is parked
(the public launch waits) rather than paying for an always-on GPU.

## Consequences
- Positive: about $0 idle; costs scale with real use and are capped per day; no GPU to manage;
  no inference-client change (ADR 0003 env vars only); the caps are T-016.
- Negative / risks:
  - Photos are sent to DigitalOcean: the privacy notice and the post must cite DO's data-use
    and retention terms (Q-9, G-3 reworded as "provider with stated retention").
  - When the daily cap is reached, every player is refused until 00:00 UTC; the cap is a
    configuration value to raise if real use grows.
  - Unverified vision support, accuracy and latency until the check below.
- Follow-ups:
  - 👤 **DO check (accepts this ADR):** create an inference key, confirm `gemma-4-31B-it` (or
    the current Gemma vision model) is listed by `GET /v1/models`, then run
    `npm run spike -- spike-photos` with `INFERENCE_BASE_URL`/`INFERENCE_MODEL`/
    `INFERENCE_API_KEY` set to DO. Pass = images accepted, ≥ 80 % correct, 100 % parseable,
    capture p95 ≤ 8 s, and DO's retention and training-use terms for prompts/images are
    acceptable and cited (Q-9). Record the result in design.md and product.md Q-7/Q-10 (T-018).
  - Build the daily call caps (task T-016) before any deploy that uses pay-per-use inference.
  - Off-box backups (NFR-014) and a privacy notice (Q-11) before announcing the service.

[DO inference pricing]: https://docs.digitalocean.com/products/inference/details/pricing/
[DO supported models]: https://docs.digitalocean.com/products/inference/details/models/
[DO GPU Droplet pricing]: https://www.digitalocean.com/pricing/gpu-droplets
