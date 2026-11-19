// Higiena repozytorium: w plikach nie może być danych, które wyglądają na prawdziwe numery
// albo adresy e-mail. Jedyne dozwolone ciągi 12 i więcej cyfr to dwa fikcyjne numery PPE.
// Test przegląda wszystkie pliki w katalogu repozytorium poza .git, także nieśledzone,
// żeby złapać plik, zanim ktoś go doda do commita.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const KORZEN = fileURLToPath(new URL("..", import.meta.url));
const POMIJANE_KATALOGI = new Set([".git", "node_modules"]);
const POMIJANE_PLIKI = new Set([".DS_Store"]);

export const DOZWOLONE_PPE = new Set(["590000000000000010", "590000000000000021"]);
const DOZWOLONE_ADRESY = [/^raporty@prosumentlab\.pl$/, /@example\.invalid$/];

function plikiRepo(katalog = KORZEN) {
  const wynik = [];
  for (const wpis of readdirSync(katalog, { withFileTypes: true })) {
    const sciezka = join(katalog, wpis.name);
    if (wpis.isDirectory()) {
      if (!POMIJANE_KATALOGI.has(wpis.name)) wynik.push(...plikiRepo(sciezka));
    } else if (wpis.isFile() && !POMIJANE_PLIKI.has(wpis.name)) {
      wynik.push(sciezka);
    }
  }
  return wynik;
}

function wzgledna(sciezka) {
  return relative(KORZEN, sciezka).split(sep).join("/");
}

// W pliku sum kontrolnych pierwsze 64 znaki linii to skrót szesnastkowy, a nie numer.
function trescDoSprawdzenia(sciezka) {
  const tresc = readFileSync(sciezka, "latin1");
  if (wzgledna(sciezka).endsWith("SHA256SUMS")) {
    return tresc
      .split("\n")
      .map((linia) => linia.slice(66))
      .join("\n");
  }
  return tresc;
}

test("w repozytorium nie ma ciągów 12 i więcej cyfr poza dwoma fikcyjnymi PPE", () => {
  const trafienia = [];
  for (const sciezka of plikiRepo()) {
    for (const m of trescDoSprawdzenia(sciezka).matchAll(/\d{12,}/g)) {
      if (!DOZWOLONE_PPE.has(m[0])) trafienia.push(`${wzgledna(sciezka)}: ciąg ${m[0].length} cyfr`);
    }
  }
  assert.deepEqual(trafienia, []);
});

test("w repozytorium nie ma numeru PPE rozdzielonego spacjami ani myślnikami", () => {
  const trafienia = [];
  for (const sciezka of plikiRepo()) {
    for (const m of trescDoSprawdzenia(sciezka).matchAll(/590(?:[ -]?\d){15}/g)) {
      const cyfry = m[0].replace(/[ -]/g, "");
      if (!DOZWOLONE_PPE.has(cyfry)) trafienia.push(`${wzgledna(sciezka)}: możliwy PPE`);
    }
  }
  assert.deepEqual(trafienia, []);
});

test("w repozytorium nie ma adresów e-mail poza adresem zgłoszeń i domeną example.invalid", () => {
  const trafienia = [];
  const wzorzec = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  for (const sciezka of plikiRepo()) {
    for (const m of trescDoSprawdzenia(sciezka).matchAll(wzorzec)) {
      if (!DOZWOLONE_ADRESY.some((d) => d.test(m[0]))) {
        trafienia.push(`${wzgledna(sciezka)}: adres e-mail`);
      }
    }
  }
  assert.deepEqual(trafienia, []);
});
