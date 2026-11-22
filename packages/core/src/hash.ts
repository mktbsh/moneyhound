/**
 * Stable fingerprint for import rows that have no institution id.
 * Not a security hash. Two different rows can theoretically collide;
 * adapters that see duplicate fingerprints in one file add an occurrence suffix.
 */
export function contentHash(parts: readonly string[]): string {
  const data = parts.join('\u001f')
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5 ^ 0x01000193
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193)
    h2 = Math.imul(h2 ^ (code + i), 0x01000193)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}
