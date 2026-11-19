// Sprawdzenia statyczne strony (app/main.js, app/index.html), których nie obejmuje N21.
// Zachowanie w przeglądarce sprawdza narzedzia/proba-przegladarki.mjs (poza node --test).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MAIN = readFileSync(fileURLToPath(new URL("../app/main.js", import.meta.url)), "utf8");
const HTML = readFileSync(fileURLToPath(new URL("../app/index.html", import.meta.url)), "utf8");

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
    assert.match(a, /rel:\s*"noopener"/, a);
  }
  assert.doesNotMatch(HTML, /<a\b(?![^>]*target="_blank")[^>]*href="(?:https?:|\/)/, "odnośniki w index.html");
});
