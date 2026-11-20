// N21: test statyczny katalogu app/. Narzędzie niczego nie wysyła, niczego nie zapisuje
// w przeglądarce, nie doładowuje kodu w trakcie pracy i nie wstawia tekstu jako HTML.
// Dodatkowo w app/lib/ nie ma zamiany tekstu na liczbę zmiennoprzecinkową ani obiektu Date
// z tekstu. Wyjątek: odnośnik mailto: po zapisie (zwykły odnośnik, nie wywołanie).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../app/", import.meta.url));

function pliki(katalog = APP) {
  const wynik = [];
  for (const wpis of readdirSync(katalog, { withFileTypes: true })) {
    const sciezka = join(katalog, wpis.name);
    if (wpis.isDirectory()) wynik.push(...pliki(sciezka));
    else wynik.push(sciezka);
  }
  return wynik;
}

const wzgledna = (s) => relative(APP, s).split(sep).join("/");

// [opis, wzorzec, czy dotyczy pliku (ścieżka względna), przykład, który musi trafić, przykład, który nie może]
const REGULY = [
  ["fetch", /\bfetch\b/, () => true, "fetch(url)", "prefetchowanie"],
  ["XMLHttpRequest", /XMLHttpRequest/, () => true, "new XMLHttpRequest()", "XmlHttp"],
  ["WebSocket", /WebSocket/, () => true, "new WebSocket(u)", "gniazdo"],
  ["sendBeacon", /sendBeacon/, () => true, "navigator.sendBeacon(u)", "send(x)"],
  ["EventSource", /EventSource/, () => true, "new EventSource(u)", "Event"],
  ["import()", /\bimport\s*\(/, () => true, "await import('./x.js')", 'import { a } from "./a.js";'],
  ["<form action>", /<form\b[^>]*\baction\s*=/i, () => true, '<form method="post" action="/x">', "<form>"],
  ["location =", /\blocation\s*=(?!=)/, () => true, "window.location = u", "location === x"],
  ["location.href =", /\blocation\.href\s*=(?!=)/, () => true, "location.href = u", "a.href = u"],
  ["location.assign/replace", /\blocation\.(?:assign|replace)\s*\(/, () => true, "location.assign(u)", "tekst.replace(a, b)"],
  ["window.open", /\bwindow\.open\s*\(/, () => true, "window.open(u)", "okno.open"],
  ['<script src="http', /<script\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\//i, () => true, '<script src="https://cdn/x.js">', '<script type="module" src="main.js">'],
  ['<link href="http', /<link\b[^>]*\bhref\s*=\s*["']?(?:https?:)?\/\//i, () => true, '<link rel="stylesheet" href="//cdn/x.css">', '<link rel="stylesheet" href="style.css">'],
  ["@import i url() z adresem zewnętrznym", /@import|url\(\s*["']?(?:https?:)?\/\//i, () => true, "src: url('https://x/f.woff2')", 'url("/czcionki/a.woff2")'],
  ["innerHTML", /\binnerHTML\b/, () => true, "el.innerHTML = t", "el.textContent = t"],
  ["outerHTML", /\bouterHTML\b/, () => true, "el.outerHTML = t", "el.textContent = t"],
  ["insertAdjacentHTML", /insertAdjacentHTML/, () => true, "el.insertAdjacentHTML('x', t)", "el.append(t)"],
  ["document.write", /\bdocument\.write(?:ln)?\s*\(/, () => true, "document.write(t)", "document.title"],
  ["localStorage", /localStorage/, () => true, "localStorage.setItem(a, b)", "pamiec"],
  ["sessionStorage", /sessionStorage/, () => true, "sessionStorage.x", "sesja"],
  ["indexedDB", /indexedDB/i, () => true, "indexedDB.open(x)", "indeks"],
  ["document.cookie", /document\.cookie/, () => true, "document.cookie = x", "ciastko"],
  ["eval i Function", /\beval\s*\(|\bnew\s+Function\s*\(/, () => true, "eval(x)", "ewaluacja"],
  ["Number( w lib", /\bNumber\s*\(/, (p) => p.startsWith("lib/"), "Number(t)", "Number.isSafeInteger(x)"],
  ["parseFloat w lib", /parseFloat/, (p) => p.startsWith("lib/"), "parseFloat(t)", "czytajKwote(t)"],
  ["parseInt w lib", /parseInt/, (p) => p.startsWith("lib/"), "parseInt(t, 10)", "liczbaZCyfr(t)"],
  ["Date.parse w lib", /Date\.parse/, (p) => p.startsWith("lib/"), "Date.parse(t)", "Date.UTC(r, m, d)"],
  ["new Date( w lib", /\bnew\s+Date\s*\(/, (p) => p.startsWith("lib/"), "new Date(2025, 0, 1)", "Date.UTC(2025, 0, 1)"],
  ["new Date(z argumentem) poza lib", /\bnew\s+Date\s*\((?!\s*\))/, (p) => !p.startsWith("lib/"), "new Date(tekst)", "new Date()"],
];

test("N21: reguły testu statycznego trafiają w przykłady i nie trafiają w kod dozwolony", () => {
  for (const [opis, wzorzec, , trafia, nieTrafia] of REGULY) {
    assert.match(trafia, wzorzec, `${opis}: przykład zakazany`);
    assert.doesNotMatch(nieTrafia, wzorzec, `${opis}: przykład dozwolony`);
  }
});

test("N21: w app/ nie ma zabronionych wywołań", () => {
  const trafienia = [];
  for (const sciezka of pliki()) {
    const p = wzgledna(sciezka);
    if (p === "SHA256SUMS") continue;
    const tresc = readFileSync(sciezka, "utf8");
    for (const [opis, wzorzec, dotyczy] of REGULY) {
      if (dotyczy(p) && wzorzec.test(tresc)) trafienia.push(`${p}: ${opis}`);
    }
  }
  assert.deepEqual(trafienia, []);
});

test("N21: jedyny adres poza stroną to mailto: do zgłoszeń i odnośniki do strony i repozytorium", () => {
  // http://www.w3.org/2000/svg to identyfikator przestrzeni nazw w atrybucie xmlns pliku SVG;
  // przeglądarka niczego spod niego nie pobiera.
  const dozwolone = [/^http:\/\/www\.w3\.org\/2000\/svg$/, /^mailto:raporty@prosumentlab\.pl/, /^mailto:\$\{ADRES\}\?/, /^https:\/\/github\.com\/twiktorowicz\/prosumentlab-przygotowanie-pliku(?:\/|$)/];
  const zle = [];
  for (const sciezka of pliki()) {
    const p = wzgledna(sciezka);
    if (p === "SHA256SUMS") continue;
    const tresc = readFileSync(sciezka, "utf8");
    for (const m of tresc.matchAll(/\b(?:https?:\/\/|mailto:)[^\s"'`)<>]*/g)) {
      if (!dozwolone.some((d) => d.test(m[0]))) zle.push(`${p}: ${m[0]}`);
    }
  }
  assert.deepEqual(zle, []);
});

test("N21: odnośniki do stron serwisu tylko do /prywatnosc/ i /jak-pobrac-dane-z-elicznika/", () => {
  const DOZWOLONE = new Set(["/prywatnosc/", "/jak-pobrac-dane-z-elicznika/"]);
  const znalezione = new Set();
  const zle = [];
  for (const sciezka of pliki()) {
    const p = wzgledna(sciezka);
    if (p === "SHA256SUMS") continue;
    const tresc = readFileSync(sciezka, "utf8");
    for (const m of tresc.matchAll(/\bhref(?:\s*=\s*|:\s*)["'](\/[^"']*)["']/g)) {
      znalezione.add(m[1]);
      if (!DOZWOLONE.has(m[1])) zle.push(`${p}: ${m[1]}`);
    }
  }
  assert.deepEqual(zle, []);
  assert.deepEqual([...znalezione].sort(), ["/jak-pobrac-dane-z-elicznika/", "/prywatnosc/"]);
});
