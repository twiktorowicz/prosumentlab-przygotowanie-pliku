// Niezależny czytnik ZIP do testów: sprawdza katalog centralny, nagłówki lokalne, CRC-32
// i rozmiary. Liczy CRC własną, bitową implementacją, bez tablicy z app/lib/crc32.js.

function crcBitowo(bajty) {
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
    const dodatkoweLokalne = u16(l + 28);
    const start = l + 30 + wpis.dlugoscNazwy + dodatkoweLokalne;
    wpis.bajty = zip.slice(start, start + wpis.skompresowany);
    if (wpis.metoda !== 0 || wpis.skompresowany !== wpis.rozmiar) throw new Error("oczekiwany zapis bez kompresji");
    if (crcBitowo(wpis.bajty) !== wpis.crc) throw new Error(`zła suma CRC: ${wpis.nazwa}`);
    wynik.push(wpis);
    oczekiwanyLokalny = start + wpis.skompresowany;
    o += 46 + wpis.dlugoscNazwy + wpis.dodatkowe + wpis.komentarz;
  }
  if (oczekiwanyLokalny !== poczatekKatalogu) throw new Error("dane między plikami a katalogiem");
  return wynik;
}
