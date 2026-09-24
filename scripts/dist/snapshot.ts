/**
 * Write `compatibility/contract/dsh-<version>/` for a dsh checkout at a tag: the contract
 * the release publishes (`contract-gen` over a vanilla tree of that release)
 * and the fingerprint of the tag's `docs/persistence-schema.json`. When the
 * pinned release already has a snapshot, print the contract difference between
 * the two: the part of a sync that needs a person.
 *
 *   node --import tsx scripts/dist/snapshot.ts <dsh checkout at a tag>
 * @module scripts/dist/snapshot
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { flatten, readSnapshot } from './contract-check.ts'
import { generateContract, writeContract } from './contract-gen.ts'
import { readUpstreamPin, repoRoot, stableJson } from './kernel.ts'
import { persistenceFingerprint } from './overlay.ts'
import { releaseOfCheckout, vanillaTree } from './trees.ts'

function printDifference(from: string, to: string): void {
  const before = readSnapshot(from)
  const after = readSnapshot(to)
  const persistence = (version: string): Map<string, string> => {
    const { roots } = JSON.parse(readFileSync(join(repoRoot, 'compatibility/contract', `dsh-${version}`, 'persistence.json'), 'utf8')) as { roots: unknown }
    return flatten(roots, ['persistence', 'roots'])
  }
  for (const [key, value] of persistence(from)) before.set(key, value)
  for (const [key, value] of persistence(to)) after.set(key, value)
  const removed = [...before.keys()].filter(key => !after.has(key))
  const added = [...after.keys()].filter(key => !before.has(key))
  const changed = [...after.keys()].filter(key => before.has(key) && before.get(key) !== after.get(key))
  console.log(`contract ${from} → ${to}: ${String(removed.length)} removed, ${String(changed.length)} changed, ${String(added.length)} added`)
  for (const key of removed) console.log(`  removed  ${key}`)
  for (const key of changed) console.log(`  changed  ${key}`)
  for (const key of added) console.log(`  added    ${key}`)
}

async function main(): Promise<void> {
  const checkout = process.argv[2]
  if (checkout === undefined) throw new Error('usage: snapshot.ts <dsh checkout at a tag>')
  const release = releaseOfCheckout(checkout)
  const out = join(repoRoot, 'compatibility/contract', `dsh-${release.dsh}`)
  writeContract(await generateContract(vanillaTree('contract', {}, release)), out)
  const fingerprint = persistenceFingerprint(readFileSync(join(checkout, 'docs/persistence-schema.json'), 'utf8'))
  writeFileSync(join(out, 'persistence.json'), stableJson({
    $comment: 'Fingerprint of upstream docs/persistence-schema.json at this tag: the durable-record vocabulary (session header, event envelopes, payload types). The full schema stays upstream; scripts/dist/overlay.ts regenerates it from lyteboat\'s kernel sources and compares against these digests.',
    source: 'docs/persistence-schema.json',
    ...fingerprint,
  }))
  console.log(`snapshot of dsh ${release.dsh} written to ${out}`)
  const pinned = readUpstreamPin().dsh
  if (pinned !== release.dsh && existsSync(join(repoRoot, 'compatibility/contract', `dsh-${pinned}`))) printDifference(pinned, release.dsh)
}

await main()
