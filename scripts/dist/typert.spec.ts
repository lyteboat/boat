import { expect, test, vi } from 'vitest'
import { typertSourceDigest } from './typert.ts'

// Windows' path.relative answers with backslashes; win32's does so on any platform.
const platform = vi.hoisted(() => ({ windows: false }))
vi.mock('node:path', async (importOriginal) => {
  const path = await importOriginal<typeof import('node:path')>()
  const relative = (from: string, to: string): string => (platform.windows ? path.win32.relative(from, to) : path.relative(from, to))
  return { ...path, relative, default: { ...path, relative } }
})

test('typertSourceDigest is the same when path.relative answers with Windows separators', () => {
  // session-controller's src/ has nested directories, so its relative paths carry separators.
  const posix = typertSourceDigest('api/session-controller')
  platform.windows = true
  const windows = typertSourceDigest('api/session-controller')
  platform.windows = false

  expect(windows).toBe(posix)
})
