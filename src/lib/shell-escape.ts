/** Escape a value for safe use in single-quoted shell strings.
 * Single-quoted strings don't interpret $, `, \, or any other special chars. */
export function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
