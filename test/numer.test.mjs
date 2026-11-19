// Numer zgłoszenia: 8 znaków z 32-znakowego alfabetu, zapis XXXX-XXXX.

import { test } from "node:test";
import assert from "node:assert/strict";
import { numerZBajtow, losowyNumer, ALFABET } from "../app/lib/numer.js";

// Prosty, powtarzalny generator bajtów (xorshift32) zamiast crypto.getRandomValues.
function zrodloZZiarnem(ziarno) {
  let s = ziarno >>> 0 || 1;
  return (tablica) => {
    for (let i = 0; i < tablica.length; i++) {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      tablica[i] = s & 0xff;
    }
    return tablica;
  };
}

test("alfabet bez I, L, O, U", () => {
  assert.equal(ALFABET, "0123456789ABCDEFGHJKMNPQRSTVWXYZ");
  assert.equal(new Set(ALFABET).size, 32);
});

test("numer z bajtów: bajt & 31", () => {
  assert.equal(numerZBajtow(Uint8Array.from([0, 1, 2, 3, 28, 29, 30, 31])), "0123-WXYZ");
  assert.equal(numerZBajtow(Uint8Array.from([32, 33, 255, 224, 10, 18, 20, 26])), "01Z0-AJMT");
  assert.throws(() => numerZBajtow(new Uint8Array(7)));
});

test("N19: 10 000 numerów z ziarnem pasuje do wzorca, rozkład znaków równomierny", () => {
  const losuj = zrodloZZiarnem(20261119);
  const wzorzec = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
  const licznik = new Map([...ALFABET].map((z) => [z, 0]));
  for (let i = 0; i < 10000; i++) {
    const numer = losowyNumer(losuj);
    assert.match(numer, wzorzec);
    for (const z of numer.replace("-", "")) licznik.set(z, licznik.get(z) + 1);
  }
  // Test chi-kwadrat: 80 000 znaków, 32 kategorie, 31 stopni swobody.
  // Wartość krytyczna dla poziomu istotności 0,001 to 61,098.
  const oczekiwana = 80000 / 32;
  let chi2 = 0;
  for (const n of licznik.values()) chi2 += ((n - oczekiwana) * (n - oczekiwana)) / oczekiwana;
  assert.ok(chi2 < 61.098, `chi-kwadrat ${chi2}`);
});

test("losowy numer domyślnie z crypto.getRandomValues", () => {
  assert.match(losowyNumer(), /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
});
