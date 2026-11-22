// CRC-32, zapis JSON i plik ZIP z kompresją (metoda 8) albo bez niej (metoda 0, gdy przeglądarka
// nie ma CompressionStream("deflate-raw")). N20 jest w test/zgloszenie.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { crc32 } from "../app/lib/crc32.js";
import { doJson } from "../app/lib/json.js";
import { utworzZip } from "../app/lib/zip.js";
import { czytajZip } from "./pomoc/czytnik-zip.mjs";
import { bezKompresji } from "./pomoc/bez-kompresji.mjs";

const utf8 = (t) => new TextEncoder().encode(t);

// Pliki do prób: krótki tekst, plik pusty i dłuższy plik w rodzaju CSV, który kompresja wyraźnie
// zmniejsza.
const PLIKI = [
  { nazwa: "a.txt", bajty: utf8("Ala\n") },
  { nazwa: "pusty.json", bajty: new Uint8Array(0) },
  { nazwa: "pomiary_1.csv", bajty: utf8("x;y\n" + Array.from({ length: 2000 }, (_, i) => `2025-01-01 ${i % 24};${(i * 7) % 13},${i % 1000}\n`).join("")) },
];

test("CRC-32: wartości kontrolne", () => {
  assert.equal(crc32(utf8("")), 0);
  assert.equal(crc32(utf8("123456789")), 0xcbf43926);
  assert.equal(crc32(utf8("The quick brown fox jumps over the lazy dog")), 0x414fa339);
});

test("JSON: kolejność kluczy, wcięcie 2 spacje, LF na końcu, polskie znaki bez zmian", () => {
  assert.equal(doJson({ b: 1, a: ["x", true] }), '{\n  "b": 1,\n  "a": [\n    "x",\n    true\n  ]\n}\n');
  assert.equal(doJson({ nazwa: "Opłata handlowa" }), '{\n  "nazwa": "Opłata handlowa"\n}\n');
});

test("JSON: odrzuca liczby niecałkowite, NaN, null i nieznane typy", () => {
  for (const zle of [{ a: 1.5 }, { a: NaN }, { a: null }, { a: undefined }, { a: () => 1 }, [Infinity], { a: 2 ** 60 }]) {
    assert.throws(() => doJson(zle), JSON.stringify(zle) ?? "funkcja");
  }
});

test("ZIP powstaje asynchronicznie: utworzZip zwraca obietnicę", async () => {
  const wynik = utworzZip(PLIKI);
  assert.ok(wynik instanceof Promise);
  assert.ok((await wynik) instanceof Uint8Array);
});

test("ZIP z kompresją: metoda 8, zawartość po rozpakowaniu równa danym, CRC z danych przed kompresją, oba rozmiary", async () => {
  const zip = await utworzZip(PLIKI);
  const odczyt = czytajZip(zip);
  assert.deepEqual(odczyt.map((p) => p.nazwa), ["a.txt", "pusty.json", "pomiary_1.csv"]);
  odczyt.forEach((p, i) => {
    const wejscie = PLIKI[i].bajty;
    assert.equal(p.metoda, 8, p.nazwa);
    assert.deepEqual(new Uint8Array(inflateRawSync(p.spakowane)), wejscie, `${p.nazwa}: zlib.inflateRawSync`);
    assert.deepEqual(p.bajty, wejscie, p.nazwa);
    assert.equal(p.crc, crc32(wejscie), `${p.nazwa}: CRC z danych przed kompresją`);
    assert.equal(p.rozmiar, wejscie.length, `${p.nazwa}: rozmiar po rozpakowaniu`);
    assert.equal(p.skompresowany, p.spakowane.length, `${p.nazwa}: rozmiar spakowany`);
    assert.equal(p.wersjaPotrzebna, 20, "2.0: deflate");
    assert.equal(p.flagi, 0, "bez szyfrowania, bez deskryptora danych, zwykła kompresja");
    assert.equal(p.data, 0x0021, "1.01.1980");
    assert.equal(p.czas, 0);
    assert.equal(p.dodatkowe, 0);
    assert.equal(p.dodatkoweLokalne, 0);
  });
  assert.ok(odczyt[2].skompresowany * 3 < odczyt[2].rozmiar, "długi plik wyraźnie mniejszy po kompresji");
});

for (const wariant of ["brak", "bez-deflate-raw"]) {
  test(`ZIP bez kompresji deflate-raw w przeglądarce (${wariant}): metoda 0, jak dotąd`, async () => {
    const zip = await bezKompresji(() => utworzZip(PLIKI), wariant);
    assert.equal(typeof globalThis.CompressionStream, "function", "CompressionStream przywrócony");
    const odczyt = czytajZip(zip);
    assert.deepEqual(odczyt.map((p) => p.nazwa), ["a.txt", "pusty.json", "pomiary_1.csv"]);
    odczyt.forEach((p, i) => {
      assert.equal(p.metoda, 0, p.nazwa);
      assert.equal(p.wersjaPotrzebna, 10, "1.0 wystarcza bez kompresji");
      assert.equal(p.flagi, 0);
      assert.equal(p.skompresowany, p.rozmiar);
      assert.deepEqual(p.spakowane, PLIKI[i].bajty);
      assert.equal(p.crc, crc32(PLIKI[i].bajty));
    });
    // Po przywróceniu znów z kompresją.
    assert.equal(czytajZip(await utworzZip(PLIKI))[0].metoda, 8);
  });
}

test("ZIP: te same dane dają te same bajty (z kompresją i bez); nazwy tylko ASCII", async () => {
  assert.deepEqual(await utworzZip(PLIKI), await utworzZip(PLIKI));
  assert.deepEqual(await bezKompresji(() => utworzZip(PLIKI)), await bezKompresji(() => utworzZip(PLIKI)));
  await assert.rejects(() => utworzZip([{ nazwa: "zażółć.txt", bajty: utf8("x") }]));
  await assert.rejects(() => utworzZip([{ nazwa: "", bajty: utf8("x") }]));
});

test("ZIP: nazwa pliku bez /, \\ i ..", async () => {
  for (const nazwa of ["a/b.txt", "/a.txt", "a\\b.txt", "..", "../a.txt", "a..b.txt", "a/../b.txt"]) {
    await assert.rejects(() => utworzZip([{ nazwa, bajty: utf8("x") }]), /nazwa/, nazwa);
  }
  await assert.doesNotReject(() => utworzZip([{ nazwa: "pomiary_1.csv", bajty: utf8("x") }]));
});

test("ZIP: gotowa suma CRC daje te same bajty co liczona", async () => {
  const bajty = utf8("energia;1\n");
  assert.deepEqual(await utworzZip([{ nazwa: "a.csv", bajty, crc: crc32(bajty) }]), await utworzZip([{ nazwa: "a.csv", bajty }]));
});

// Pola wpisów katalogu centralnego czytane wprost z bajtów, bez czytnika z test/pomoc: skrypt
// przyjmujący zgłoszenia odrzuca każdy wpis, który nie ma systemu 0 w polu „wersja tworzenia”
// (starszy bajt), ma niezerowe atrybuty pliku (wewnętrzne albo zewnętrzne; zewnętrzne niosą
// prawa pliku z Uniksa i znacznik dowiązania), komentarz albo pola dodatkowe (we wpisie albo
// w nagłówku lokalnym). Zwraca listę naruszeń.
function naruszeniaWpisow(zip) {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);
  const eocd = zip.length - 22;
  const liczba = u16(eocd + 10);
  const naruszenia = [];
  let o = u32(eocd + 16);
  for (let i = 0; i < liczba; i++) {
    assert.equal(u32(o), 0x02014b50, "podpis wpisu katalogu");
    const dlugoscNazwy = u16(o + 28);
    const dodatkowe = u16(o + 30);
    const komentarz = u16(o + 32);
    if (u16(o + 4) >> 8 !== 0) naruszenia.push(`${i}: system ${u16(o + 4) >> 8} w wersji tworzenia`);
    if (dodatkowe !== 0) naruszenia.push(`${i}: pola dodatkowe we wpisie`);
    if (komentarz !== 0) naruszenia.push(`${i}: komentarz`);
    if (u16(o + 36) !== 0) naruszenia.push(`${i}: atrybuty wewnętrzne`);
    if (u32(o + 38) !== 0) naruszenia.push(`${i}: atrybuty zewnętrzne`);
    if (u16(u32(o + 42) + 28) !== 0) naruszenia.push(`${i}: pola dodatkowe w nagłówku lokalnym`);
    o += 46 + dlugoscNazwy + dodatkowe + komentarz;
  }
  return naruszenia;
}

test("ZIP: każdy wpis katalogu ma system 0, zerowe atrybuty, bez komentarza i bez pól dodatkowych (metoda 8 i 0)", async () => {
  const zKompresja = await utworzZip(PLIKI);
  const bez = await bezKompresji(() => utworzZip(PLIKI));
  for (const [opis, zip] of [["metoda 8", zKompresja], ["metoda 0", bez]]) {
    assert.deepEqual(naruszeniaWpisow(zip), [], opis);
    for (const p of czytajZip(zip)) {
      assert.equal(p.wersjaTworzenia >> 8, 0, `${opis} ${p.nazwa}: system 0 (MS-DOS)`);
      assert.equal(p.atrybutyWewnetrzne, 0, `${opis} ${p.nazwa}`);
      assert.equal(p.atrybutyZewnetrzne, 0, `${opis} ${p.nazwa}`);
      assert.equal(p.komentarz, 0, `${opis} ${p.nazwa}`);
      assert.equal(p.dodatkowe, 0, `${opis} ${p.nazwa}`);
      assert.equal(p.numerDysku, 0, `${opis} ${p.nazwa}`);
    }
  }
});

test("sprawdzenie pól wpisu wykrywa każde naruszenie (zepsuty bajt w gotowym ZIP-ie)", async () => {
  const zip = await utworzZip([{ nazwa: "a.txt", bajty: utf8("Ala\n") }]);
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const katalog = dv.getUint32(zip.length - 22 + 16, true);
  const zepsuj = (przesuniecie, zapis) => {
    const kopia = zip.slice();
    zapis(new DataView(kopia.buffer), przesuniecie);
    return naruszeniaWpisow(kopia);
  };
  assert.deepEqual(zepsuj(katalog + 5, (d, o) => d.setUint8(o, 3)), ["0: system 3 w wersji tworzenia"], "Unix");
  assert.deepEqual(zepsuj(katalog + 30, (d, o) => d.setUint16(o, 4, true)), ["0: pola dodatkowe we wpisie"]);
  assert.deepEqual(zepsuj(katalog + 32, (d, o) => d.setUint16(o, 1, true)), ["0: komentarz"]);
  assert.deepEqual(zepsuj(katalog + 36, (d, o) => d.setUint16(o, 1, true)), ["0: atrybuty wewnętrzne"]);
  assert.deepEqual(zepsuj(katalog + 38, (d, o) => d.setUint32(o, 0x81a40000, true)), ["0: atrybuty zewnętrzne"], "prawa pliku z Uniksa");
  assert.deepEqual(zepsuj(28, (d, o) => d.setUint16(o, 4, true)), ["0: pola dodatkowe w nagłówku lokalnym"]);
});
