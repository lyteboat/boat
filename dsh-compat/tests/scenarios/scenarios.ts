/**
 * G4's scripted scenarios: each one drives `dsh headless` through a distinct
 * path of the kernel (a plain answer, a tool round trip, reasoning blocks, a
 * retried request, a truncated answer) with upstream's mock model server.
 * @module dsh-compat/tests/scenarios/scenarios
 */

import type { OfficialScenario } from '../support/official-cli.ts'

const README = { 'README.md': '# compatibility workspace\n\nThe answer is forty-two.\n' }

export const G4_SCENARIOS: readonly OfficialScenario[] = [
  { name: 'answer', task: 'say hello', sequence: ['success'], mock: { successText: 'G4-ANSWER' }, files: README },
  {
    name: 'tool-read',
    task: 'read the readme and report',
    sequence: ['tool_call_success', 'success'],
    mock: { toolName: 'read', toolArguments: JSON.stringify({ file_path: 'README.md' }), successText: 'G4-TOOL' },
    files: README,
  },
  { name: 'reasoning', task: 'think, then answer', sequence: ['reasoning_success'], mock: { reasoningText: 'G4-THINKING', successText: 'G4-REASONED' }, files: README },
  { name: 'retry', task: 'answer after a transient failure', sequence: ['server_error', 'success'], mock: { successText: 'G4-RETRIED' }, files: README },
  { name: 'max-tokens', task: 'answer at length', sequence: ['max_tokens'], mock: { partialText: 'G4-TRUNCATED' }, files: README },
]
