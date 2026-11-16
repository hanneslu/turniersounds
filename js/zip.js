// Minimaler ZIP-Leser/-Schreiber ohne Fremdbibliothek.
// Schreiben: unkomprimiert ("stored") – Audiodateien sind bereits komprimiert.
// Lesen: "stored" und "deflate" (z. B. von Windows oder iOS gepackte Archive).

const TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  TABLE[n] = c >>> 0;
}

export async function crc32Blob(blob) {
  let c = 0xFFFFFFFF;
  const CHUNK = 4 * 1024 * 1024;
  for (let off = 0; off < blob.size; off += CHUNK) {
    const u8 = new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer());
    for (let i = 0; i < u8.length; i++) c = TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// entries: [{ name, blob, crc? }]
export async function makeZip(entries) {
  const enc = new TextEncoder();
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = [];
  let offset = 0, cdSize = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const size = e.blob.size;
    const crc = e.crc != null ? e.crc : await crc32Blob(e.blob);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true);
    parts.push(lh.buffer, name, e.blob);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true); cd.setUint16(12, time, true); cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, size, true); cd.setUint32(24, size, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(cd.buffer, name);
    cdSize += 46 + name.length;
    offset += 30 + name.length + size;
  }
  if (offset + cdSize > 0xFFFFFFF0 || entries.length > 65000) {
    throw new Error('Das Paket wäre größer als 4 GB. Bitte weniger Songs in ein Paket legen.');
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// Liefert [{ name, blob(): Promise<Blob> }]
export async function readZip(file) {
  const tailLen = Math.min(file.size, 65557);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let p = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { p = i; break; }
  }
  if (p < 0) throw new Error('Die Datei ist kein gültiges ZIP-Paket.');
  const count = tail.getUint16(p + 10, true);
  const cdSize = tail.getUint32(p + 12, true);
  const cdOffset = tail.getUint32(p + 16, true);
  if (cdOffset === 0xFFFFFFFF || count === 0xFFFF) {
    throw new Error('ZIP-Pakete über 4 GB werden nicht unterstützt.');
  }
  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const out = [];
  let o = 0;
  for (let i = 0; i < count && o + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(o, true) !== 0x02014b50) break;
    const method = cd.getUint16(o + 10, true);
    const csize = cd.getUint32(o + 20, true);
    const nlen = cd.getUint16(o + 28, true);
    const elen = cd.getUint16(o + 30, true);
    const clen = cd.getUint16(o + 32, true);
    const lho = cd.getUint32(o + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, o + 46, nlen));
    o += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    out.push({
      name,
      async blob() {
        const lh = new DataView(await file.slice(lho, lho + 30).arrayBuffer());
        const start = lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        const raw = file.slice(start, start + csize);
        if (method === 0) return raw;
        if (method !== 8 || typeof DecompressionStream === 'undefined') {
          throw new Error('Nicht unterstützte ZIP-Komprimierung: ' + name);
        }
        return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      },
    });
  }
  return out;
}
