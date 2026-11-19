// CRC-32 w wariancie z formatu ZIP (wielomian 0xEDB88320, wartość początkowa i końcowa
// odwrócone), liczone z tablicy 256 wartości.

const TABLICA = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  TABLICA[n] = c >>> 0;
}

export function crc32(bajty) {
  let crc = 0xffffffff;
  for (let i = 0; i < bajty.length; i++) crc = TABLICA[(crc ^ bajty[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
