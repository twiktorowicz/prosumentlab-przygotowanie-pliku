// Plik ZIP bez kompresji (metoda 0, „store”), bez zależności.
// - Stała data w nagłówkach: 1.01.1980, 00:00, więc te same dane dają ten sam plik co do bajtu.
// - Bez pól dodatkowych, bez deskryptora danych, bez ZIP64; nazwy plików w ASCII.
// - Kolejność plików jak w liście wejściowej.

import { crc32 } from "./crc32.js";

const DATA_1980 = (0 << 9) | (1 << 5) | 1; // rok 1980 + 0, styczeń, 1. dzień
const WERSJA_POTRZEBNA = 10; // 1.0 wystarcza dla zapisu bez kompresji
const WERSJA_TWORZENIA = 20; // 2.0, system 0 (MS-DOS)

export function utworzZip(pliki) {
  const wpisy = pliki.map(({ nazwa, bajty }) => {
    if (typeof nazwa !== "string" || !/^[\x21-\x7e]+$/.test(nazwa)) throw new Error("nazwa pliku w ZIP-ie musi być w ASCII");
    return { nazwa: new TextEncoder().encode(nazwa), bajty, crc: crc32(bajty) };
  });

  const rozmiarLokalnych = wpisy.reduce((s, w) => s + 30 + w.nazwa.length + w.bajty.length, 0);
  const rozmiarKatalogu = wpisy.reduce((s, w) => s + 46 + w.nazwa.length, 0);
  const wynik = new Uint8Array(rozmiarLokalnych + rozmiarKatalogu + 22);
  const dv = new DataView(wynik.buffer);
  let o = 0;
  const u16 = (v) => { dv.setUint16(o, v, true); o += 2; };
  const u32 = (v) => { dv.setUint32(o, v, true); o += 4; };
  const bajty = (b) => { wynik.set(b, o); o += b.length; };

  for (const w of wpisy) {
    w.przesuniecie = o;
    u32(0x04034b50);
    u16(WERSJA_POTRZEBNA);
    u16(0); // flagi
    u16(0); // metoda: bez kompresji
    u16(0); // czas 00:00
    u16(DATA_1980);
    u32(w.crc);
    u32(w.bajty.length);
    u32(w.bajty.length);
    u16(w.nazwa.length);
    u16(0); // pola dodatkowe
    bajty(w.nazwa);
    bajty(w.bajty);
  }

  const poczatekKatalogu = o;
  for (const w of wpisy) {
    u32(0x02014b50);
    u16(WERSJA_TWORZENIA);
    u16(WERSJA_POTRZEBNA);
    u16(0);
    u16(0);
    u16(0);
    u16(DATA_1980);
    u32(w.crc);
    u32(w.bajty.length);
    u32(w.bajty.length);
    u16(w.nazwa.length);
    u16(0); // pola dodatkowe
    u16(0); // komentarz
    u16(0); // numer dysku
    u16(0); // atrybuty wewnętrzne
    u32(0); // atrybuty zewnętrzne
    u32(w.przesuniecie);
    bajty(w.nazwa);
  }

  const koniecKatalogu = o;
  u32(0x06054b50);
  u16(0); // numer dysku
  u16(0); // dysk z katalogiem
  u16(wpisy.length);
  u16(wpisy.length);
  u32(koniecKatalogu - poczatekKatalogu);
  u32(poczatekKatalogu);
  u16(0); // komentarz
  return wynik;
}
