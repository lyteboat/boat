/**
 * A stand-in for the launcher's `lyteboat eval` that the Studio's eval jobs
 * start: it reads the flags the job passes, writes the run where the real
 * process does (`$LYTEBOAT_HOME/evals/<run id>`: run.json and results.jsonl),
 * prints a ✓ or ✗ line per case and the summary, and exits 0 or 1. A replay
 * fails its `second` case, so two runs compare with a regression; the case
 * `hold` waits for SIGINT and exits 130, as the launcher does; the agent
 * `broken` fails to start, exiting 2 with an error line.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(3)
const valueOf = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const valuesOf = name => args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : []))

const runId = valueOf('--run-id')
const agent = valueOf('--agent')
const mode = valueOf('--model') ?? 'real'
const from = valueOf('--from')
const picked = valuesOf('--case')
const cases = picked.length > 0 ? picked : ['first', 'second']

if (agent === 'broken') {
  process.stderr.write('lyteboat: eval-runner: the agent failed to mount\n')
  process.exit(2)
}

if (cases.includes('hold')) {
  process.on('SIGINT', () => process.exit(130))
  process.stdout.write('holding until stopped\n')
  setInterval(() => {}, 1000)
} else {
  const results = cases.map((id) => {
    const pass = !(mode === 'replay' && id === 'second')
    return {
      case: id, turn: 1, message: `${id} message`,
      observed: { skill: null, tools: [], cards: [], outcome: pass ? 'completed' : 'errored', text: `OK:${id}`, modelRequests: 1 },
      checks: [{ check: 'outcome', expected: 'completed', actual: pass ? 'completed' : 'errored', pass }],
      pass,
    }
  })
  const dir = join(process.env.LYTEBOAT_HOME ?? '', 'evals', runId ?? '')
  mkdirSync(dir, { recursive: true })
  const passed = results.filter(result => result.pass).length
  writeFileSync(join(dir, 'results.jsonl'), results.map(result => JSON.stringify(result)).join('\n') + '\n')
  writeFileSync(join(dir, 'run.json'), JSON.stringify({
    agent: { id: agent, digest: `sha256:${'0'.repeat(64)}` }, mode, ...from === undefined ? {} : { from },
    cases: results.map(result => ({ id: result.case, pass: result.pass })),
    turns: { total: results.length, passed }, checks: { total: results.length, passed },
    startedAt: new Date().toISOString(), durationMs: 5,
  }))
  for (const result of results) process.stdout.write(result.pass ? `✓ ${result.case} (1 turn)\n` : `✗ ${result.case}: turn 1 outcome\n`)
  process.stdout.write(`lyteboat eval: ${String(passed)}/${String(results.length)} cases passed; report: ${dir}/report.md\n`)
  process.exit(passed === results.length ? 0 : 1)
}
