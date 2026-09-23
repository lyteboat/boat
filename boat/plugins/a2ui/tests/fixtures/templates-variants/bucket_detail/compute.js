// digest only: the card body is bound in the manifest.
export function digest(_raw, flat) {
  return `[卡片:bucket] ${flat.title}`
}
