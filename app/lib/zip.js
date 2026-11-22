// Plik ZIP, bez zależności.
// - Pliki kompresowane metodą 8 (deflate) przez CompressionStream("deflate-raw"), wbudowany
//   w przeglądarkę i w Node. Przeglądarka bez tego formatu (brak CompressionStream albo
//   konstruktor odrzuca "deflate-raw") dostaje ZIP bez kompresji (metoda 0, „store”); taki ZIP
//   też jest poprawny, tylko większy. Gdy budowa z kompresją się nie powiedzie (na przykład
//   strumień kompresji zgłosi błąd), cały ZIP powstaje od nowa metodą 0; ZIP nigdy nie miesza
//   metod. Gdy i to się nie uda, obietnica jest odrzucona.
// - Kompresja jest asynchroniczna, więc utworzZip zwraca obietnicę.
// - CRC-32 liczone z danych przed kompresją; nagłówki podają oba rozmiary (spakowany i po
//   rozpakowaniu).
// - Stała data w nagłówkach: 1.01.1980, 00:00, więc te same dane dają ten sam plik co do bajtu
//   (przy kompresji: w obrębie jednej implementacji, bo różne przeglądarki mogą pakować inaczej;
//   zawartość po rozpakowaniu jest zawsze ta sama).
// - Bez pól dodatkowych, bez deskryptora danych, bez ZIP64; nazwy plików w ASCII, bez katalogów:
//   nazwa z „/”, „\” albo „..” jest odrzucana, żeby rozpakowanie nie pisało poza katalog.
// - Wpisy katalogu centralnego: system 0 (MS-DOS) w polu „wersja tworzenia”, zerowe atrybuty pliku
//   (wewnętrzne i zewnętrzne), bez komentarzy. Skrypt przyjmujący zgłoszenia odrzuca każdy inny
//   wpis, bo atrybuty z Uniksa niosą prawa pliku i znacznik dowiązania symbolicznego.
// - Kolejność plików jak w liście wejściowej.
// - Plik może przyjść z gotową sumą `crc` (CSV zakodowany raz przy odczycie pliku); bez niej
//   suma jest liczona tutaj.

import { crc32 } from "./crc32.js";

const DATA_1980 = (0 << 9) | (1 << 5) | 1; // rok 1980 + 0, styczeń, 1. dzień
// Wersja potrzebna do rozpakowania: 1.0 wystarcza dla zapisu bez kompresji, deflate wymaga 2.0.
const WERSJA_POTRZEBNA = { 0: 10, 8: 20 };
const WERSJA_TWORZENIA = 20; // 2.0, system 0 (MS-DOS) w starszym bajcie

// Czy przeglądarka umie kompresować do surowego deflate. Starsze przeglądarki mają
// CompressionStream tylko z formatami "gzip" i "deflate"; konstruktor zgłasza wtedy wyjątek.
function kompresjaDostepna() {
  if (typeof CompressionStream !== "function") return false;
  try {
    new CompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

// Surowy deflate (bez nagłówka zlib) przez strumień przeglądarki. Zapis i odczyt idą równolegle,
// bo strumień nie przyjmie całych danych, dopóki nikt nie odbiera wyniku.
async function deflateRaw(bajty) {
  const strumien = new CompressionStream("deflate-raw");
  const pisarz = strumien.writable.getWriter();
  const czytnik = strumien.readable.getReader();
  const czesci = [];
  let dlugosc = 0;
  const odczyt = (async () => {
    for (;;) {
      const { done, value } = await czytnik.read();
      if (done) return;
      czesci.push(value);
      dlugosc += value.length;
    }
  })();
  await Promise.all([pisarz.write(bajty).then(() => pisarz.close()), odczyt]);
  const wynik = new Uint8Array(dlugosc);
  let o = 0;
  for (const c of czesci) {
    wynik.set(c, o);
    o += c.length;
  }
  return wynik;
}

export async function utworzZip(pliki) {
  const wpisy = pliki.map(({ nazwa, bajty, crc }) => {
    if (typeof nazwa !== "string" || !/^[\x21-\x7e]+$/.test(nazwa)) throw new Error("nazwa pliku w ZIP-ie musi być w ASCII");
    if (/[/\\]|\.\./.test(nazwa)) throw new Error("nazwa pliku w ZIP-ie nie może zawierać /, \\ ani ..");
    return { nazwa: new TextEncoder().encode(nazwa), bajty, crc: crc ?? crc32(bajty) };
  });

  if (kompresjaDostepna()) {
    try {
      return await zbuduj(wpisy, 8);
    } catch {
      // Budowa z kompresją nie powiodła się: ZIP bez kompresji, taki sam jak w przeglądarce bez niej.
    }
  }
  return zbuduj(wpisy, 0);
}

async function zbuduj(wpisy, metoda) {
  const dane = [];
  for (const w of wpisy) dane.push(metoda === 8 ? await deflateRaw(w.bajty) : w.bajty);
  wpisy = wpisy.map((w, i) => ({ ...w, dane: dane[i] }));

  const rozmiarLokalnych = wpisy.reduce((s, w) => s + 30 + w.nazwa.length + w.dane.length, 0);
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
    u16(WERSJA_POTRZEBNA[metoda]);
    u16(0); // flagi: bez szyfrowania, bez deskryptora danych, zwykły stopień kompresji
    u16(metoda);
    u16(0); // czas 00:00
    u16(DATA_1980);
    u32(w.crc);
    u32(w.dane.length); // rozmiar spakowany
    u32(w.bajty.length); // rozmiar po rozpakowaniu
    u16(w.nazwa.length);
    u16(0); // pola dodatkowe
    bajty(w.nazwa);
    bajty(w.dane);
  }

  const poczatekKatalogu = o;
  for (const w of wpisy) {
    u32(0x02014b50);
    u16(WERSJA_TWORZENIA);
    u16(WERSJA_POTRZEBNA[metoda]);
    u16(0); // flagi
    u16(metoda);
    u16(0); // czas
    u16(DATA_1980);
    u32(w.crc);
    u32(w.dane.length);
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
