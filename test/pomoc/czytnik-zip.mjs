// Niezależny czytnik ZIP do testów: sprawdza katalog centralny, nagłówki lokalne, CRC-32
// i rozmiary. Liczy CRC własną, bitową implementacją, bez tablicy z app/lib/crc32.js.
// Metoda 0 (bez kompresji) i 8 (deflate); dane metody 8 rozpakowuje zlib z Node, niezależny od
// CompressionStream, którym pakuje narzędzie. `bajty` to zawsze dane po rozpakowaniu,
// `spakowane` to bajty tak, jak leżą w pliku.

import { inflateRawSync } from "node:zlib";

export function crcBitowo(bajty) {
  let crc = 0xffffffff;
  for (const b of bajty) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function czytajZip(zip) {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);
  const eocd = zip.length - 22;
  if (u32(eocd) !== 0x06054b50) throw new Error("brak końca katalogu centralnego");
  if (u16(eocd + 20) !== 0) throw new Error("niepusty komentarz");
  const liczba = u16(eocd + 10);
  if (u16(eocd + 8) !== liczba) throw new Error("różna liczba wpisów");
  const rozmiarKatalogu = u32(eocd + 12);
  const poczatekKatalogu = u32(eocd + 16);
  if (poczatekKatalogu + rozmiarKatalogu !== eocd) throw new Error("katalog centralny nie przylega do końca");

  const wynik = [];
  let o = poczatekKatalogu;
  let oczekiwanyLokalny = 0;
  for (let i = 0; i < liczba; i++) {
    if (u32(o) !== 0x02014b50) throw new Error("zły podpis wpisu katalogu");
    const wpis = {
      wersjaTworzenia: u16(o + 4),
      wersjaPotrzebna: u16(o + 6),
      flagi: u16(o + 8),
      metoda: u16(o + 10),
      czas: u16(o + 12),
      data: u16(o + 14),
      crc: u32(o + 16),
      skompresowany: u32(o + 20),
      rozmiar: u32(o + 24),
      dlugoscNazwy: u16(o + 28),
      dodatkowe: u16(o + 30),
      komentarz: u16(o + 32),
      numerDysku: u16(o + 34),
      atrybutyWewnetrzne: u16(o + 36),
      atrybutyZewnetrzne: u32(o + 38),
      lokalny: u32(o + 42),
    };
    wpis.nazwa = new TextDecoder("ascii").decode(zip.subarray(o + 46, o + 46 + wpis.dlugoscNazwy));
    if (wpis.lokalny !== oczekiwanyLokalny) throw new Error("nagłówki lokalne nie leżą jeden po drugim");

    const l = wpis.lokalny;
    if (u32(l) !== 0x04034b50) throw new Error("zły podpis nagłówka lokalnego");
    const zgodne =
      u16(l + 4) === wpis.wersjaPotrzebna && u16(l + 6) === wpis.flagi && u16(l + 8) === wpis.metoda &&
      u16(l + 10) === wpis.czas && u16(l + 12) === wpis.data && u32(l + 14) === wpis.crc &&
      u32(l + 18) === wpis.skompresowany && u32(l + 22) === wpis.rozmiar && u16(l + 26) === wpis.dlugoscNazwy;
    if (!zgodne) throw new Error(`nagłówek lokalny różni się od katalogu: ${wpis.nazwa}`);
    if (new TextDecoder("ascii").decode(zip.subarray(l + 30, l + 30 + wpis.dlugoscNazwy)) !== wpis.nazwa) {
      throw new Error(`nazwa w nagłówku lokalnym różni się od katalogu: ${wpis.nazwa}`);
    }
    wpis.dodatkoweLokalne = u16(l + 28);
    const start = l + 30 + wpis.dlugoscNazwy + wpis.dodatkoweLokalne;
    // Zawsze kopia jako Uint8Array, także gdy wejście to Buffer z readFileSync.
    wpis.spakowane = new Uint8Array(zip.subarray(start, start + wpis.skompresowany));
    if (wpis.metoda === 0) {
      if (wpis.skompresowany !== wpis.rozmiar) throw new Error(`metoda 0: różne rozmiary: ${wpis.nazwa}`);
      wpis.bajty = wpis.spakowane;
    } else if (wpis.metoda === 8) {
      wpis.bajty = new Uint8Array(inflateRawSync(wpis.spakowane));
      if (wpis.bajty.length !== wpis.rozmiar) throw new Error(`metoda 8: rozmiar po rozpakowaniu inny niż w nagłówku: ${wpis.nazwa}`);
    } else {
      throw new Error(`nieznana metoda ${wpis.metoda}: ${wpis.nazwa}`);
    }
    if (crcBitowo(wpis.bajty) !== wpis.crc) throw new Error(`zła suma CRC: ${wpis.nazwa}`);
    wynik.push(wpis);
    oczekiwanyLokalny = start + wpis.skompresowany;
    o += 46 + wpis.dlugoscNazwy + wpis.dodatkowe + wpis.komentarz;
  }
  if (oczekiwanyLokalny !== poczatekKatalogu) throw new Error("dane między plikami a katalogiem");
  return wynik;
}
