// Pin every DeepSeek Harness package (direct and transitive) to the versions in
// dsh.upstream.json. Published dsh packages depend on each other with caret
// ranges, so without this hook a fresh install drifts to a newer prerelease
// than the tag boat was developed against. The kernel packages (dsh/kernel.json)
// are left alone: pnpm-workspace.yaml overrides route them to the workspace, and
// this hook runs after the overrides, so pinning them would undo the route.
const upstream = require('./dsh.upstream.json')
const kernel = new Set(Object.keys(require('./dsh/kernel.json').packages))

function pinned(name) {
  if (kernel.has(name)) return undefined
  if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) return upstream.dsh
  return upstream.cordis[name]
}

function pin(deps) {
  if (!deps) return
  for (const name of Object.keys(deps)) {
    const version = pinned(name)
    if (version !== undefined) deps[name] = version
  }
}

module.exports = {
  hooks: {
    readPackage(pkg) {
      pin(pkg.dependencies)
      pin(pkg.optionalDependencies)
      pin(pkg.peerDependencies)
      return pkg
    },
  },
}
