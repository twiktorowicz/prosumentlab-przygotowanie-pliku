// CRC-32, zapis JSON i plik ZIP bez kompresji. N20 jest w test/zgloszenie.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "../app/lib/crc32.js";
import { doJson } from "../app/lib/json.js";
import { utworzZip } from "../app/lib/zip.js";
import { czytajZip } from "./pomoc/czytnik-zip.mjs";

const utf8 = (t) => new TextEncoder().encode(t);

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

test("ZIP: nagłówki, kolejność, CRC i rozmiary zgodne z niezależnym czytnikiem", () => {
  const pliki = [
    { nazwa: "a.txt", bajty: utf8("Ala\n") },
    { nazwa: "pusty.json", bajty: new Uint8Array(0) },
    { nazwa: "pomiary_1.csv", bajty: utf8("x;y\n1;2\n") },
  ];
  const zip = utworzZip(pliki);
  const odczyt = czytajZip(zip);
  assert.deepEqual(odczyt.map((p) => p.nazwa), ["a.txt", "pusty.json", "pomiary_1.csv"]);
  odczyt.forEach((p, i) => {
    assert.deepEqual(p.bajty, pliki[i].bajty);
    assert.equal(p.metoda, 0);
    assert.equal(p.data, 0x0021, "1.01.1980");
    assert.equal(p.czas, 0);
    assert.equal(p.flagi, 0);
    assert.equal(p.dodatkowe, 0);
  });
});

test("ZIP: te same dane dają te same bajty; nazwy tylko ASCII", () => {
  const pliki = [{ nazwa: "a.txt", bajty: utf8("x") }];
  assert.deepEqual(utworzZip(pliki), utworzZip(pliki));
  assert.throws(() => utworzZip([{ nazwa: "zażółć.txt", bajty: utf8("x") }]));
  assert.throws(() => utworzZip([{ nazwa: "", bajty: utf8("x") }]));
});
