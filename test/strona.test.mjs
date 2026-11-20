// Sprawdzenia statyczne strony (app/main.js, app/index.html), których nie obejmuje N21.
// Zachowanie w przeglądarce sprawdza narzedzia/proba-przegladarki.mjs (poza node --test).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ROK_MIN, ROK_MAKS } from "../app/lib/kalendarz.js";

const MAIN = readFileSync(fileURLToPath(new URL("../app/main.js", import.meta.url)), "utf8");
const HTML = readFileSync(fileURLToPath(new URL("../app/index.html", import.meta.url)), "utf8");

test("ZIP powstaje tylko przy zapisie: utworzZipZgloszenia wołane wyłącznie w funkcji zapisz", () => {
  const funkcja = /\nfunction zapisz\(\) \{\n([\s\S]*?)\n\}\n/.exec(MAIN);
  assert.ok(funkcja, "funkcja zapisz");
  assert.equal((MAIN.match(/\butworzZipZgloszenia\s*\(/g) ?? []).length, 1);
  assert.match(funkcja[1], /\butworzZipZgloszenia\s*\(/);
  assert.doesNotMatch(MAIN, /wynik\.zip\b/);
});

test("pliki przetwarzane raz: strona nie woła przygotujZgloszenie, tylko przygotujPliki i zlozZgloszenie", () => {
  assert.doesNotMatch(MAIN, /\bprzygotujZgloszenie\s*\(/);
  assert.equal((MAIN.match(/\bprzygotujPliki\s*\(/g) ?? []).length, 1, "przygotujPliki w jednym miejscu (zmiana listy plików)");
  assert.match(MAIN, /\bzlozZgloszenie\s*\(/);
});

test("odnośniki otwierają się w nowej karcie, żeby nie skasować danych z pamięci strony", () => {
  const odnosniki = [...MAIN.matchAll(/el\("a",\s*\{([^}]*)\}/g)].map((m) => m[1]).filter((a) => /href:/.test(a) && !/download/.test(a));
  assert.ok(odnosniki.length >= 2, "odnośnik zgody i repozytorium");
  for (const a of odnosniki) {
    assert.match(a, /target:\s*"_blank"/, a);
    assert.match(a, /rel:\s*"noopener noreferrer"/, a);
  }
  assert.doesNotMatch(HTML, /<a\b(?![^>]*target="_blank")[^>]*href="(?:https?:|\/)/, "odnośniki w index.html");
});

test("pola daty okresu faktury w zakresie lat narzędzia", () => {
  const pola = [...HTML.matchAll(/<input type="date"[^>]*>/g)].map((m) => m[0]);
  assert.equal(pola.length, 2);
  for (const p of pola) {
    assert.match(p, new RegExp(`min="${ROK_MIN}-01-01"`), p);
    assert.match(p, new RegExp(`max="${ROK_MAKS}-12-31"`), p);
  }
});

test("podpowiedź przy każdym polu na nazwę, widoczna stale", () => {
  for (const pole of ["sprzedawca_nazwa", "taryfa_nazwa", "oplaty_stale_inne"]) {
    const kontener = new RegExp(`data-pole="${pole}"[^>]*>([\\s\\S]*?)</(?:div|fieldset)>`).exec(HTML);
    assert.ok(kontener, pole);
    assert.match(kontener[1], /<p class="podpowiedz" data-tekst="tekst_wolny_podpowiedz"><\/p>/, pole);
  }
});

test("podpowiedź o kolejności stref tylko przy taryfie „inna”", () => {
  const linia = MAIN.split("\n").find((l) => l.includes('$("#strefy-kolejnosc")'));
  assert.ok(linia);
  assert.match(linia, /taryfa === "inna"/);
  assert.doesNotMatch(linia, /g12/);
});

test("uwaga o miesiącu zmiany spoza zakresu ma styl uwagi, nie błędu", () => {
  const linie = MAIN.split("\n");
  const i = linie.findIndex((l) => l.includes('t("instalacja_miesiac_poza_zakresem")'));
  assert.ok(i > 0);
  const okolica = linie.slice(i - 3, i + 1).join("\n");
  assert.match(okolica, /\$\("\.uwaga", /, okolica);
  assert.doesNotMatch(okolica, /\$\("\.blad", /, okolica);
  assert.match(MAIN, /el\("p", \{ klasa: "uwaga", hidden: true \}\)/, "element uwagi w wierszu zmiany");
});

test("lista plików: limit 10 pozycji przed odczytem, odczyt z blokadą dodawania i usuwania", () => {
  assert.match(MAIN, /MAKS_PLIKOW/, "strona używa limitu z modułu zgłoszenia");
  assert.match(MAIN, /\$\("#wybor-plikow"\)\.disabled = /, "pole wyboru plików nieaktywne w trakcie odczytu");
  assert.match(MAIN, /blad_za_duzo_plikow/);
  assert.match(MAIN, /arrayBuffer\(\)/);
});
