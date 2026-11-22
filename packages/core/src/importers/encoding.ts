export type DetectedEncoding = 'utf-8-bom' | 'utf-8' | 'utf-16' | 'shift_jis'

export interface DecodeResult {
  text: string
  encoding: DetectedEncoding
}

/**
 * Decode a statement file the owner selected.
 * Order follows common Japanese bank/MF exports: UTF-8 BOM, UTF-16 BOM, strict UTF-8, else Shift_JIS.
 * Adapted from ossannote2025/mf-csv-viewer (MIT). See THIRD_PARTY_NOTICES.md.
 */
export function decodeCsvBytes(input: Uint8Array): DecodeResult {
  if (input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(input.subarray(3)), encoding: 'utf-8-bom' }
  }
  if (
    input.length >= 2 &&
    ((input[0] === 0xff && input[1] === 0xfe) || (input[0] === 0xfe && input[1] === 0xff))
  ) {
    const label = input[0] === 0xff ? 'utf-16le' : 'utf-16be'
    return { text: new TextDecoder(label).decode(input.subarray(2)), encoding: 'utf-16' }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(input), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('shift_jis').decode(input), encoding: 'shift_jis' }
  }
}
