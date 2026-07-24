export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
