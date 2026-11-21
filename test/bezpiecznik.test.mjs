// Bezpiecznik identyfikatorów, reguła 5 (adres e-mail) na długim polu. Wzorzec szukany od każdej
// pozycji cofał się po całym polu bez „@”, więc czas rósł z kwadratem długości. Reguła ma działać
// liniowo i wykrywać dokładnie to samo co dawny wzorzec. Adresy w tym pliku są składane w kodzie.

import { test } from "node:test";
import assert from "node:assert/strict";

import { sprawdzBezpiecznik } from "../app/lib/bezpiecznik.js";

const linie = (...t) => t.map((tekst, i) => ({ tekst, linia: i + 1 }));
const MB = 1024 * 1024;
// Opcja timeout z node:test nie przerywa kodu synchronicznego, więc test mierzy czas sam.
const LIMIT_MS = 2000;

function wCzasie(opis, tekst) {
  const t0 = performance.now();
  const wynik = sprawdzBezpiecznik(linie(tekst), []);
  const czas = performance.now() - t0;
  assert.ok(czas < LIMIT_MS, `${opis}: sprawdzenie trwało ${czas.toFixed(0)} ms`);
  return wynik;
}

test("pole 1 MB bez „@” i z „@” na końcu: bez trafienia, w limicie czasu", () => {
  assert.equal(wCzasie("bez @", "a".repeat(MB)), null);
  assert.equal(wCzasie("@ na końcu", `${"a".repeat(MB - 1)}@`), null);
  assert.equal(wCzasie("kropki bez @", "a.".repeat(MB / 2)), null);
  assert.equal(wCzasie("same @", "@".repeat(MB)), null);
  assert.equal(wCzasie("@ co drugi znak", "a@".repeat(MB / 2)), null);
});

test("pole 1 MB z adresem na końcu: trafienie w limicie czasu", () => {
  const adres = ["a", "example.invalid"].join("@");
  assert.deepEqual(wCzasie("adres na końcu", `${"a".repeat(MB)} ${adres}`), { linia: 1 });
  assert.deepEqual(wCzasie("adres doklejony", `${"a".repeat(MB)}${adres}`), { linia: 1 });
});

// Dawny wzorzec reguły 5, tylko do porównania na krótkich ciągach.
const DAWNY = /[^\s@;]+@[^\s@;]+\.[^\s@;]+/;

test("reguła 5 wykrywa to samo co dawny wzorzec: krótkie ciągi z generatora deterministycznego", () => {
  // Znaki, od których zależy wynik: litery, kropka, „@”, średnik, różne odstępy, samotny surogat.
  const ZNAKI = ["a", "b", "c", "ż", ".", ".", "@", "@", ";", " ", "\t", "\u00a0", "\u2028", "\ud800"];
  // mulberry32: 32-bitowe działania na liczbach całkowitych, ten sam ciąg przy każdym uruchomieniu.
  let stan = 12345;
  const losowa = (n) => {
    stan = (stan + 0x6d2b79f5) | 0;
    let x = Math.imul(stan ^ (stan >>> 15), 1 | stan);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) % n;
  };
  let trafien = 0;
  for (let i = 0; i < 100000; i++) {
    const dlugosc = losowa(16);
    let tekst = "";
    for (let j = 0; j < dlugosc; j++) tekst += ZNAKI[losowa(ZNAKI.length)];
    const oczekiwane = DAWNY.test(tekst) ? { linia: 1 } : null;
    if (oczekiwane) trafien++;
    assert.deepEqual(sprawdzBezpiecznik(linie(tekst), [], { regula6: false }), oczekiwane, JSON.stringify(tekst));
  }
  assert.ok(trafien > 1000, `ciągi z trafieniem: ${trafien}`);
});
