// A plugin written the way a third party would use a boat extension: it
// declares `inject: ['boatDistro']`, so it loads only on boat, and answers every
// task through the `boat/intake` extension with the extension ids it found.
export const name = 'example-distro-aware'
export const inject = ['boatDistro']

export function apply(ctx) {
  ctx.on('boat/intake', async () => ({
    kind: 'reply',
    plugin: name,
    content: [{ type: 'text', text: `boat on dsh ${ctx.boatDistro.dsh}: ${ctx.boatDistro.extensions.map(extension => extension.id).join(', ')}` }],
  }))
}
