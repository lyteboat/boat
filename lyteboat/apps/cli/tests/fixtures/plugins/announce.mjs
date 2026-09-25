// A plugin file that writes one line to stderr when applied: run.e2e inserts it with
// --plugin and looks for the line, which proves the row ran, not only that it loaded;
// args.spec needs a second existing file.
export const name = 'fixture-announce'

export function apply() {
  process.stderr.write('fixture-announce: applied\n')
}
