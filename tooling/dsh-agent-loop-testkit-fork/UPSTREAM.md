# Upstream

Forked from deepseek-ai/deepseek-harness `packages/test-support/agent-loop-testkit/src` at dsh-v0.1.5-alpha.2 (b2e3b2a0125854567a4a5fcba75782e42fe84901), MIT.
Only the driver's synced upstream tests (`packages/agentic-loop/tests`) use this package; boat's own tests use `@boat/testing`. Keep it verbatim so a future upstream test that needs another testkit export still compiles after a re-sync.

Re-sync with `node --import tsx scripts/sync-upstream.ts <checkout>`; identity rewrites are listed in that script.

## Divergence from upstream

None beyond the identity rewrites: the testkit is byte-identical to the rewritten upstream.
