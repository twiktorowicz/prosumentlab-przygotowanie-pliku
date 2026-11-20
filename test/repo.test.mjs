// Higiena repozytorium: w plikach nie może być danych, które wyglądają na prawdziwe numery
// albo adresy e-mail. Jedyne dozwolone ciągi 12 i więcej cyfr to dwa fikcyjne numery PPE.
// Ciąg od 8 do 11 cyfr, przy którym nie stoi litera ani cyfra (numer klienta, PESEL, telefon),
// jest dozwolony tylko z listy wyjątków.
// Test przegląda wszystkie pliki w katalogu repozytorium poza .git, node_modules i proby/ (wyniki
// prób lokalnych, wykluczone z repozytorium), także nieśledzone, żeby złapać plik, zanim ktoś go
// doda do commita. Pliki tekstowe są czytane jako UTF-8, pliki binarne pomijane.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const KORZEN = fileURLToPath(new URL("..", import.meta.url));
export const POMIJANE = new Set([".git", "node_modules", "proby"]);
const POMIJANE_PLIKI = new Set([".DS_Store"]);
const BINARNE = /\.(zip|woff2|png|ico)$/;

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
      if (!POMIJANE.has(wpis.name)) wynik.push(...plikiRepo(sciezka));
    } else if (wpis.isFile() && !POMIJANE_PLIKI.has(wpis.name)) {
      wynik.push(sciezka);
    }
  }
  return wynik;
}

function wzgledna(sciezka) {
  return relative(KORZEN, sciezka).split(sep).join("/");
}

// Skrót szesnastkowy 40 znaków (commit) albo 64 znaki (SHA-256) z co najmniej jedną literą a–f,
// bez litery ani cyfry obok. Ciąg samych cyfr nie jest skrótem i zostaje do sprawdzenia.
const SKROT = /(?<![\p{L}\p{N}])(?=[0-9]*[a-f])(?:[0-9a-f]{64}|[0-9a-f]{40})(?![\p{L}\p{N}])/gu;

// Treść pliku do szukania numerów: null dla pliku binarnego, w pozostałych tekst z UTF-8
// (odczyt jako latin1 zamieniał bajty znaków typograficznych w litery, więc numer przed „””
// albo „–” przechodził) bez skrótów szesnastkowych.
export function trescDoSkanu(sciezka, bajty) {
  if (BINARNE.test(sciezka)) return null;
  return new TextDecoder("utf-8").decode(bajty).replace(SKROT, " ");
}

// Pliki do skanu: [ścieżka względna, treść], bez plików binarnych.
function plikiDoSkanu() {
  return plikiRepo()
    .map((sciezka) => [wzgledna(sciezka), trescDoSkanu(sciezka, readFileSync(sciezka))])
    .filter(([, tresc]) => tresc !== null);
}

export function trafienia8do11(tresc) {
  return [...tresc.matchAll(CIAG_8_11)].map((m) => m[0]).filter((c) => !DOZWOLONE_8_11.has(c));
}

test("w repozytorium nie ma ciągów 12 i więcej cyfr poza dwoma fikcyjnymi PPE", () => {
  const trafienia = [];
  for (const [sciezka, tresc] of plikiDoSkanu()) {
    for (const m of tresc.matchAll(/\d{12,}/g)) {
      if (!DOZWOLONE_PPE.has(m[0])) trafienia.push(`${sciezka}: ciąg ${m[0].length} cyfr`);
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
  for (const [sciezka, tresc] of plikiDoSkanu()) {
    for (const ciag of trafienia8do11(tresc)) trafienia.push(`${sciezka}: ciąg ${ciag.length} cyfr`);
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
  for (const [sciezka, tresc] of plikiDoSkanu()) {
    for (const m of tresc.matchAll(/590(?:[ -]?\d){15}/g)) {
      const cyfry = m[0].replace(/[ -]/g, "");
      if (!DOZWOLONE_PPE.has(cyfry)) trafienia.push(`${sciezka}: możliwy PPE`);
    }
  }
  assert.deepEqual(trafienia, []);
});

test("w repozytorium nie ma adresów e-mail poza adresem zgłoszeń i domeną example.invalid", () => {
  const trafienia = [];
  const wzorzec = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  for (const [sciezka, tresc] of plikiDoSkanu()) {
    for (const m of tresc.matchAll(wzorzec)) {
      if (!DOZWOLONE_ADRESY.some((d) => d.test(m[0]))) {
        trafienia.push(`${sciezka}: adres e-mail`);
      }
    }
  }
  assert.deepEqual(trafienia, []);
});

// Znaki niewidoczne w źródłach utrudniają przegląd: twarda spacja wygląda jak zwykła, znak
// sterujący może zmienić znaczenie tekstu. W kodzie piszemy je jako sekwencje \u.
test("w plikach tekstowych nie ma znaków niewidocznych ani sterujących (poza tabulatorem i końcem linii)", () => {
  const ZAKAZANE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00a0\u00ad\u2000-\u200f\u2028-\u202f\u205f-\u206f\ufeff]/u;
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

test("skan numerów: UTF-8, znaki typograficzne obok numeru, skróty szesnastkowe, pliki binarne i proby/", () => {
  // Przykłady budowane w kodzie, żeby sam test nie zawierał ciągów, które reguła łapie.
  const osiem = "4".repeat(8);
  const skan = (tekst, sciezka = "x.md") => trafienia8do11(trescDoSkanu(sciezka, new TextEncoder().encode(tekst)));
  for (const [opis, tekst] of [
    ["cudzysłów zamykający", `„${osiem}”`], ["półpauza", `${osiem}–${"1".repeat(3)}`], ["wielokropek", `${osiem}…`],
    ["twarda spacja", `${osiem}\u00a0zł`], ["pauza przed", `—${osiem}`],
  ]) assert.deepEqual(skan(tekst), [osiem], opis);
  // Skróty: SHA-256 i skrót commitu z cyframi w środku, także w zwykłym pliku i na początku linii.
  const sha = `ab${osiem}cd${"0".repeat(52)}`;
  const commit = `f${osiem}${"9".repeat(30)}e`;
  assert.equal(sha.length, 64);
  assert.equal(commit.length, 40);
  assert.deepEqual(skan(`${sha}  index.html\n`), [], "SHA-256");
  assert.deepEqual(skan(`commit ${commit}.`), [], "skrót commitu");
  assert.deepEqual(skan(`${osiem}${"0".repeat(56)}`), [], "64 cyfry to nie 8–11 cyfr");
  assert.match(trescDoSkanu("x.md", new TextEncoder().encode("1".repeat(40))), /\d{40}/, "40 samych cyfr zostaje do sprawdzenia");
  assert.deepEqual(skan(`${sha}x ${osiem}`), [osiem], "65 znaków to nie skrót");
  // Pliki binarne pomijane w każdym skanie, katalog proby/ poza skanem.
  assert.equal(trescDoSkanu("test/wzorce/n20.zip", new TextEncoder().encode(osiem)), null);
  assert.ok(POMIJANE.has("proby"));
});

test("CI: limit czasu w każdym zadaniu", () => {
  const ci = readFileSync(join(KORZEN, ".github", "workflows", "ci.yml"), "utf8");
  const zadania = [...ci.slice(ci.indexOf("\njobs:\n")).matchAll(/^ {2}([a-z-]+):\n((?: {4}.*\n|\n)*)/gm)];
  assert.deepEqual(zadania.map((m) => m[1]), ["testy", "gitleaks"]);
  for (const [, nazwa, tresc] of zadania) assert.match(tresc, /^ {4}timeout-minutes: \d+$/m, nazwa);
});
