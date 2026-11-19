// Reads what a JPEG or PNG says about itself (type and pixel size) from its first bytes, without a decoding library. The type comes
// from the file's own signature, never from the name or the Content-Type the browser sent.
export interface ImageInfo {
  type: 'jpeg' | 'png'
  width: number
  height: number
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function readImageInfo(buf: Buffer): ImageInfo | null {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG_SIGNATURE) && buf.subarray(12, 16).toString('latin1') === 'IHDR') {
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    // Walk the JPEG segments until a "start of frame" one, which holds the size.
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]!
      if (marker === 0xff) { i++; continue } // fill byte
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue } // markers with no length
      const length = buf.readUInt16BE(i + 2)
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrame) return { type: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      if (length < 2) return null
      i += 2 + length
    }
  }
  return null
}
