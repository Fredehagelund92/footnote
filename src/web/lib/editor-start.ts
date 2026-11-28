/** The editor starts from its address: the same path with another draft, gap, metric or about is a new start. */
export const editorStart = (search: Record<string, string | undefined>) =>
  ['draft', 'gap', 'metric', 'about', 'setup'].map((k) => search[k] ?? '').join('|')
