export type DetectedEncoding = 'utf-8-bom' | 'utf-8' | 'utf-16' | 'shift_jis'

export interface DecodeResult {
  text: string
  encoding: DetectedEncoding
}

const BOMS: readonly {
  bytes: readonly number[]
  label: 'utf-8' | 'utf-16le' | 'utf-16be'
  encoding: DetectedEncoding
}[] = [
  { bytes: [0xef, 0xbb, 0xbf], label: 'utf-8', encoding: 'utf-8-bom' },
  { bytes: [0xff, 0xfe], label: 'utf-16le', encoding: 'utf-16' },
  { bytes: [0xfe, 0xff], label: 'utf-16be', encoding: 'utf-16' },
]

function startsWith(input: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => input[index] === byte)
}

/**
 * Decode a statement file the owner selected.
 * A byte order mark wins. Without one, valid UTF-8 is UTF-8, and anything
 * else is read as Shift_JIS, which most Japanese banks and card issuers still use.
 */
export function decodeCsvBytes(input: Uint8Array): DecodeResult {
  const bom = BOMS.find((candidate) => startsWith(input, candidate.bytes))
  if (bom) {
    return {
      text: new TextDecoder(bom.label).decode(input.subarray(bom.bytes.length)),
      encoding: bom.encoding,
    }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(input), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('shift_jis').decode(input), encoding: 'shift_jis' }
  }
}
