// Higiena repozytorium: w plikach nie może być danych, które wyglądają na prawdziwe numery
// albo adresy e-mail. Jedyne dozwolone ciągi 12 i więcej cyfr to dwa fikcyjne numery PPE.
// Ciąg od 8 do 11 cyfr, przy którym nie stoi litera ani cyfra (numer klienta, PESEL, telefon),
// jest dozwolony tylko z listy wyjątków.
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

// Wyjątki reguły 8–11 cyfr, każdy z osobna; ta sama lista jest w .gitleaks.toml.
export const DOZWOLONE_8_11 = new Map([
  ["10000001", "fikcyjny numer płatnika z generatora"],
  ["10000002", "drugi fikcyjny numer płatnika z generatora"],
  ["123456789", "standardowy ciąg kontrolny sumy CRC-32 w teście zip"],
]);
// Litera ani cyfra nie może stać tuż przed ciągiem ani tuż po nim, więc fragmenty skrótów
// szesnastkowych (cyfry między literami a–f) nie pasują.
export const CIAG_8_11 = /(?<![\p{L}\p{N}])\d{8,11}(?![\p{L}\p{N}])/gu;

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

test("reguła 8–11 cyfr trafia w numery i nie trafia w skróty szesnastkowe ani dłuższe ciągi", () => {
  // Przykłady budowane w kodzie, żeby sam test nie zawierał ciągów, które reguła łapie.
  const trafienia = (tekst) => [...tekst.matchAll(CIAG_8_11)].map((m) => m[0]);
  const [osiem, dziewiec, jedenascie] = ["1".repeat(8), "2".repeat(9), "3".repeat(11)];
  assert.deepEqual(trafienia(`nr ${osiem}, pesel ${jedenascie};tel:${dziewiec}`), [osiem, jedenascie, dziewiec]);
  assert.deepEqual(trafienia(`${"5".repeat(8)};${"6".repeat(8)}`), ["5".repeat(8), "6".repeat(8)], "dwa ciągi rozdzielone jednym znakiem");
  assert.deepEqual(trafienia(`68fd${"2".repeat(8)}d42e${"7".repeat(10)}cfa`), [], "cyfry skrótu szesnastkowego między literami");
  assert.deepEqual(trafienia(`abc${osiem} ${osiem}x ${"1".repeat(7)} ${"1".repeat(12)}`), [], "litera obok, 7 cyfr, 12 cyfr");
  assert.deepEqual(trafienia(`0x${osiem}`), [], "zapis szesnastkowy z literą x");
});

test("w repozytorium nie ma ciągów 8–11 cyfr poza listą wyjątków", () => {
  const trafienia = [];
  for (const sciezka of plikiRepo()) {
    for (const m of trescDoSprawdzenia(sciezka).matchAll(CIAG_8_11)) {
      if (!DOZWOLONE_8_11.has(m[0])) trafienia.push(`${wzgledna(sciezka)}: ciąg ${m[0].length} cyfr`);
    }
  }
  assert.deepEqual(trafienia, []);
});

test(".gitleaks.toml ma regułę 8–11 cyfr z tą samą listą wyjątków", () => {
  const toml = readFileSync(join(KORZEN, ".gitleaks.toml"), "utf8");
  const regula = /\[\[rules\]\]\nid = "ciag-8-11-cyfr"\n[\s\S]*?(?=\n\[\[rules\]\]|$)/.exec(toml)?.[0];
  assert.ok(regula, "reguła ciag-8-11-cyfr");
  assert.match(regula, /secretGroup = 1/);
  const wyjatki = /regexes = \['{3}\^\(([0-9|]+)\)\$'{3}\]/.exec(regula)?.[1].split("|");
  assert.deepEqual(wyjatki, [...DOZWOLONE_8_11.keys()]);
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

// Znaki niewidoczne w źródłach utrudniają przegląd: twarda spacja wygląda jak zwykła, znak
// sterujący może zmienić znaczenie tekstu. W kodzie piszemy je jako sekwencje \u.
test("w plikach tekstowych nie ma znaków niewidocznych ani sterujących (poza tabulatorem i końcem linii)", () => {
  const ZAKAZANE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00a0\u00ad\u2000-\u200f\u2028-\u202f\u205f-\u206f\ufeff]/u;
  const BINARNE = /\.(zip|woff2|png|ico)$/;
  const trafienia = [];
  for (const sciezka of plikiRepo()) {
    if (BINARNE.test(sciezka)) continue;
    const tresc = readFileSync(sciezka, "utf8");
    tresc.split("\n").forEach((linia, i) => {
      const bezCr = linia.endsWith("\r") ? linia.slice(0, -1) : linia;
      if (ZAKAZANE.test(bezCr)) trafienia.push(`${wzgledna(sciezka)}:${i + 1}`);
    });
  }
  assert.deepEqual(trafienia, []);
});
