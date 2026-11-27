import { describe, expect, it } from 'bun:test'
import { decodeCsvBytes } from './encoding'

describe('decodeCsvBytes', () => {
  it('honors a byte order mark', () => {
    const utf8 = new TextEncoder().encode('日付,金額')
    expect(decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toEqual({
      text: '日付,金額',
      encoding: 'utf-8-bom',
    })
    // 「日」 is U+65E5.
    expect(decodeCsvBytes(new Uint8Array([0xff, 0xfe, 0xe5, 0x65]))).toEqual({
      text: '日',
      encoding: 'utf-16',
    })
    expect(decodeCsvBytes(new Uint8Array([0xfe, 0xff, 0x65, 0xe5]))).toEqual({
      text: '日',
      encoding: 'utf-16',
    })
  })

  it('reads plain UTF-8, and anything else as Shift_JIS', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('摘要'))).toEqual({
      text: '摘要',
      encoding: 'utf-8',
    })
    // 「あい」 in Shift_JIS.
    expect(decodeCsvBytes(new Uint8Array([0x82, 0xa0, 0x82, 0xa2]))).toEqual({
      text: 'あい',
      encoding: 'shift_jis',
    })
  })
})
