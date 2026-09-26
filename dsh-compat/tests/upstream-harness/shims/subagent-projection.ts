/**
 * lyteboat adaptation: upstream's session-controller specs import
 * `subagentIdentityProjectionDefinition` from the subagent package's source
 * (`@deepseek-ai/dsh-subagent/src/projection.ts`), which the published package
 * does not ship. The published package carries that module compiled, unexported
 * (`lib/types/projection.js`); this re-exports it from the hoisted install.
 */
export { subagentIdentityProjectionDefinition } from '../../../../node_modules/@deepseek-ai/dsh-subagent/lib/types/projection.js'
