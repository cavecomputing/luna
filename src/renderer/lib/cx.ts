/**
 * Joins class names, dropping anything falsy.
 *
 * CSS module lookups are typed `string | undefined` under
 * noUncheckedIndexedAccess, so template literals would embed "undefined" into
 * the class attribute. This keeps that impossible.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p) => typeof p === 'string' && p !== '').join(' ')
}
