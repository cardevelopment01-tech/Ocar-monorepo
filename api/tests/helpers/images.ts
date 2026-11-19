// Tiny files with a REAL header (type and pixel size), enough for code that reads the header only. Not viewable pictures.

export function pngBytes(width: number, height: number, padTo = 0): Buffer {
  const head = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0)
  head.writeUInt32BE(13, 8) // IHDR length
  head.write('IHDR', 12, 'latin1')
  head.writeUInt32BE(width, 16)
  head.writeUInt32BE(height, 20)
  head[24] = 8 // bit depth
  head[25] = 2 // colour type
  return padTo > head.length ? Buffer.concat([head, Buffer.alloc(padTo - head.length)]) : head
}

export function jpegBytes(width: number, height: number, padTo = 0): Buffer {
  const soi = Buffer.from([0xff, 0xd8])
  // An APP0 segment first, so a reader has to skip a segment to reach the frame header.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])
  const sof = Buffer.alloc(19)
  sof[0] = 0xff
  sof[1] = 0xc0
  sof.writeUInt16BE(17, 2) // segment length
  sof[4] = 8 // precision
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  sof[9] = 3 // components
  const out = Buffer.concat([soi, app0, sof, Buffer.from([0xff, 0xd9])])
  return padTo > out.length ? Buffer.concat([out, Buffer.alloc(padTo - out.length)]) : out
}
