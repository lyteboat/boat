# Upstream

Forked from deepseek-ai/deepseek-harness `packages/test-support/agent-loop-testkit/src` at dsh-v0.1.7-alpha.2 (00102833dfaee1da9f48a3a8eae9d34005a75218), MIT.
Only the driver's synced upstream tests (`core/agentic-loop/tests`) use this package; boat's own tests use `@boat/testing`. Keep it verbatim so a future upstream test that needs another testkit export still compiles after a re-sync.

Re-sync with `node --import tsx scripts/sync-upstream.ts <checkout>`; identity rewrites are listed in that script.

## Divergence from upstream

None beyond the identity rewrites: the testkit is byte-identical to the rewritten upstream.
