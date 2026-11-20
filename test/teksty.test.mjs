// N22: teksty dla klienta w app/teksty.js. Sprawdza postać pliku, klucze, formy liczby, wstawki,
// mechaniczną część zasad stylu i to, czy każdy znak mieści się w podzbiorach czcionek strony.
// Pełny test stylu (lista STYL_ZAKAZANE) działa poza tym repozytorium na kopii katalogu app/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { TEKSTY } from "../app/teksty.js";
import { WSTAWKI } from "../app/lib/odmiana.js";

const APP = fileURLToPath(new URL("../app/", import.meta.url));
const ZRODLO = readFileSync(join(APP, "teksty.js"), "utf8");
const FORMY = ["jeden", "kilka", "wiele"];

// Wszystkie teksty jako płaska lista [klucz, tekst].
function wszystkie() {
  const wynik = [];
  for (const [klucz, w] of Object.entries(TEKSTY)) {
    if (typeof w === "string") wynik.push([klucz, w]);
    else if (Array.isArray(w)) w.forEach((t, i) => wynik.push([`${klucz}[${i}]`, t]));
    else for (const [k, t] of Object.entries(w)) wynik.push([`${klucz}.${k}`, t]);
  }
  return wynik;
}

const czyFormy = (w) => w && typeof w === "object" && !Array.isArray(w) && Object.keys(w).some((k) => FORMY.includes(k));

test("N22: część po „export const TEKSTY = ” to poprawny JSON równy eksportowi", () => {
  const poczatek = "export const TEKSTY = ";
  const i = ZRODLO.indexOf(poczatek);
  assert.ok(i > 0);
  assert.ok(ZRODLO.endsWith("};\n"));
  const json = ZRODLO.slice(i + poczatek.length, -2);
  assert.deepEqual(JSON.parse(json), TEKSTY);
  // Przed eksportem tylko komentarz z zasadami pisania, bez odsyłaczy do plików spoza repozytorium.
  const komentarz = ZRODLO.slice(0, i).split("\n");
  assert.equal(komentarz.pop(), "");
  assert.ok(komentarz.length > 0 && komentarz.every((l) => l.startsWith("// ")), "same linie komentarza");
  assert.doesNotMatch(ZRODLO.slice(0, i), /\.md\b|docs\/|prywatn/, "bez ścieżek do innych repozytoriów");
});

test("N22: wartości to tekst, lista tekstów, formy liczby albo mapa opcji", () => {
  for (const [klucz, w] of Object.entries(TEKSTY)) {
    if (typeof w === "string") continue;
    if (Array.isArray(w)) {
      assert.ok(w.length > 0 && w.every((t) => typeof t === "string"), klucz);
    } else if (czyFormy(w)) {
      assert.deepEqual(Object.keys(w), FORMY, `${klucz}: formy jeden, kilka, wiele`);
      for (const f of FORMY) assert.match(w[f], /\{n\}/, `${klucz}.${f} zawiera {n}`);
    } else {
      assert.ok(Object.values(w).every((t) => typeof t === "string"), klucz);
    }
  }
});

test("N22: wstawki tylko z dozwolonej listy", () => {
  for (const [klucz, t] of wszystkie()) {
    for (const m of t.matchAll(/\{([^{}]*)\}/g)) assert.ok(WSTAWKI.has(m[1]), `${klucz}: {${m[1]}}`);
    assert.doesNotMatch(t.replace(/\{[^{}]*\}/g, ""), /[{}]/, `${klucz}: nawias klamrowy poza wstawką`);
  }
});

test("N22: każdy kod, który moduły mogą pokazać klientowi, ma tekst", () => {
  const BEZ_TEKSTU = new Set(["blad_wyboru", "nakladanie_strefa", "nakladanie_kompletnosc"]);
  const kody = new Set();
  for (const plik of readdirSync(join(APP, "lib"))) {
    const zrodlo = readFileSync(join(APP, "lib", plik), "utf8");
    for (const m of zrodlo.matchAll(/"((?:blad|faktura|instalacja|uwaga)_[a-z0-9_]+|tekst_wolny_blad)"/g)) kody.add(m[1]);
    for (const m of zrodlo.matchAll(/"((?:UWAGA|ZAKRES|FAKTURA|INSTALACJA)_[A-Z0-9_]+)"/g)) kody.add(m[1].toLowerCase());
  }
  assert.ok(kody.size > 30, "znaleziono kody w modułach");
  const brak = [...kody].filter((k) => !BEZ_TEKSTU.has(k) && !(k in TEKSTY));
  assert.deepEqual(brak, []);
  for (const k of ["zakres_raport", "zakres_wstepny", "zakres_za_krotki", "zakres_brak"]) assert.ok(k in TEKSTY, k);
});

test("N22: opcje list wyboru mają tekst dla każdej wartości z formularza", async () => {
  const zrodlo = readFileSync(join(APP, "lib", "formularz.js"), "utf8");
  const listy = {
    opcje_sprzedawca: "sprzedawca", opcje_operator: "operator_dystrybucyjny", opcje_taryfa: "taryfa",
    opcje_rodzaj_faktury: "rodzaj_faktury", opcje_system: "system_rozliczenia", opcje_rodzaj_ceny: "rodzaj_ceny",
    opcje_magazyn: "magazyn", opcje_pierwsze_oddanie: "pierwsze_oddanie", opcje_zmiany: "rodzaj_zmiany",
  };
  for (const [klucz, lista] of Object.entries(listy)) {
    const m = new RegExp(`\\b${lista}: \\[([^\\]]*)\\]`).exec(zrodlo);
    assert.ok(m, lista);
    const wartosci = [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]);
    assert.deepEqual(Object.keys(TEKSTY[klucz]), wartosci, klucz);
  }
  assert.equal(TEKSTY.strefy_g12.length, 2);
  assert.equal(TEKSTY.strefy_g13.length, 3);
  assert.equal(TEKSTY.miesiace_mianownik.length, 12);
  assert.equal(TEKSTY.miesiace_dopelniacz.length, 12);
});

test("N22: każdy klucz użyty na stronie istnieje", () => {
  const uzyte = new Set();
  for (const m of readFileSync(join(APP, "index.html"), "utf8").matchAll(/data-tekst="([^"]+)"/g)) uzyte.add(m[1]);
  for (const m of readFileSync(join(APP, "main.js"), "utf8").matchAll(/\b(?:tekst|t)\(\s*"([a-z0-9_]+)"/g)) uzyte.add(m[1]);
  assert.ok(uzyte.size > 0, "znaleziono klucze na stronie");
  const brak = [...uzyte].filter((k) => !(k in TEKSTY));
  assert.deepEqual(brak, []);
});

test("N22: <title> i <noscript> w index.html równe tekstom", () => {
  const zrodlo = readFileSync(join(APP, "index.html"), "utf8");
  assert.equal(/<title>([^<]*)<\/title>/.exec(zrodlo)?.[1], TEKSTY.tytul_strony);
  assert.equal(/<noscript>([^<]*)<\/noscript>/.exec(zrodlo)?.[1].trim(), TEKSTY.noscript);
});

test("zgoda: jedno „Więcej: ” przed nazwą dokumentu, którą strona zamienia w odnośnik", () => {
  const czesci = TEKSTY.zgoda.split("Więcej: ");
  assert.equal(czesci.length, 2);
  assert.equal(czesci[1], "informacja o przetwarzaniu danych, punkt 3.");
});

test("styl, część mechaniczna: bez pauzy, wykrzyknika, nazw technicznych narzędzia i słów z naszej kuchni", () => {
  const ZAKAZANE = [
    /—/, /!/, /anonimiz/i, /anonimow/i, /weryfik/i, /posiada/i, /w oparciu o/i, /dedykowan/i, /\bw celu\b/i,
    /\bgeneruj/i, /\bimport\b/i, /\beksport\b/i, /dostawc/i, /\bOSD\b/, /\bsilnik/i, /\bimporter/i,
    /przypadek wzorcowy/i, /kluczow/i, /kompleksow/i, /innowacyjn/i, /gwarantuj/i, /warto zauważyć/i,
    /podsumowując/i, /\bkrótko:/i, /\bwkrótce\b/i,
  ];
  for (const [klucz, t] of wszystkie()) {
    for (const r of ZAKAZANE) assert.doesNotMatch(t, r, `${klucz}: ${r}`);
  }
});

test("styl, część mechaniczna: Ty i Twój wielką literą, bez podwójnych spacji", () => {
  const MALE = /(^|[^\p{L}])(twój|twoja|twoje|twojego|twojej|twoim|twoich|twoimi|twoją|ciebie|tobie|ci)(?![\p{L}])/u;
  for (const [klucz, t] of wszystkie()) {
    assert.doesNotMatch(t, MALE, klucz);
    assert.doesNotMatch(t, / {2}|^ | $/, `${klucz}: spacje`);
  }
});

// Zakresy unicode-range podzbiorów Latin1 i Latin2 czcionki IBM Plex Sans na stronie.
const ZAKRESY = [
  [0x20, 0x7e], [0xa0, 0xff], [0x131, 0x131], [0x152, 0x153], [0x2c6, 0x2c6], [0x2da, 0x2da], [0x2dc, 0x2dc],
  [0x2013, 0x2014], [0x2018, 0x201a], [0x201c, 0x201e], [0x2020, 0x2022], [0x2026, 0x2026], [0x2030, 0x2030],
  [0x2039, 0x203a], [0x2044, 0x2044], [0x20ac, 0x20ac], [0x2122, 0x2122], [0x2212, 0x2212], [0xfb01, 0xfb02],
  [0x100, 0x101], [0x104, 0x130], [0x132, 0x151], [0x154, 0x17f],
];

test("każdy znak tekstów mieści się w podzbiorach czcionki, bez twardych spacji", () => {
  for (const [klucz, t] of wszystkie()) {
    for (const z of t) {
      const kod = z.codePointAt(0);
      assert.ok(ZAKRESY.some(([od, doK]) => kod >= od && kod <= doK), `${klucz}: znak U+${kod.toString(16)}`);
      assert.notEqual(kod, 0xa0, `${klucz}: twarda spacja`);
    }
  }
});
