// Sprawdzenia bezpieczeństwa strony w kodzie (app/main.js, app/index.html): co i kiedy z niej
// wychodzi i co otwiera się w nowej karcie. Zostały tu, bo są szybkie i pilnują granicy strony.
// Zachowanie i strukturę strony sprawdza narzedzia/proba-przegladarki.mjs w prawdziwej przeglądarce:
// poza node --test, ale w CI jako osobne zadanie `proba-przegladarki`. Zostały tu też straże przed
// nieaktualnym ZIP-em: każdy z dwóch warunków osobno jest zbędny, ale usunięcie obu naraz próba
// przepuszcza (wyścig kompresji ze zmianą pola na kroku 5 albo 6).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MAIN = readFileSync(fileURLToPath(new URL("../app/main.js", import.meta.url)), "utf8");
const HTML = readFileSync(fileURLToPath(new URL("../app/index.html", import.meta.url)), "utf8");
const CSS = readFileSync(fileURLToPath(new URL("../app/style.css", import.meta.url)), "utf8");

// main.js bez komentarzy: linie zaczynające się od „//” i komentarze na końcu linii po odstępie.
// Adresy w tekstach („https://…”) mają przed „//” dwukropek, więc zostają.
const KOD = MAIN.replace(/^[ \t]*\/\/.*\n/gm, "").replace(/[ \t]+\/\/ .*$/gm, "");

// Ciało funkcji o danej nazwie z main.js: od linii nagłówka „function nazwa(” do pierwszej linii
// „}” na początku linii. Bez wyrażenia na parametry, więc domyślne wartości z nawiasami nie
// psują wycinania; dwie definicje o tej samej nazwie to błąd testu.
function funkcja(nazwa) {
  const naglowki = [...MAIN.matchAll(new RegExp(`\\n(?:async )?function ${nazwa}\\(`, "g"))];
  assert.equal(naglowki.length, 1, `jedna definicja: ${nazwa}`);
  const koniecNaglowka = MAIN.indexOf("\n", naglowki[0].index + 1);
  assert.ok(MAIN.slice(naglowki[0].index, koniecNaglowka).endsWith("{"), `${nazwa}: nagłówek kończy się „{”`);
  const koniec = MAIN.indexOf("\n}\n", koniecNaglowka);
  assert.ok(koniec > 0, nazwa);
  return MAIN.slice(koniecNaglowka + 1, koniec);
}

// Atrybuty każdego wywołania el("a", { … }) z main.js, z liczeniem zagnieżdżonych nawiasów
// klamrowych (wstawki ${…} w szablonach); nawiasy w tekstach w cudzysłowie się nie liczą.
function atrybutyOdnosnikow() {
  const wynik = [];
  for (const m of MAIN.matchAll(/el\("a",\s*\{/g)) {
    let glebokosc = 1;
    let cudzyslow = null;
    let i = m.index + m[0].length;
    for (; i < MAIN.length && glebokosc > 0; i++) {
      const z = MAIN[i];
      if (cudzyslow) {
        if (z === "\\") i++;
        else if (z === cudzyslow) cudzyslow = null;
      } else if (z === '"' || z === "'") cudzyslow = z;
      else if (z === "{") glebokosc++;
      else if (z === "}") glebokosc--;
    }
    assert.equal(glebokosc, 0, "domknięte atrybuty el(\"a\", …)");
    wynik.push(MAIN.slice(m.index + m[0].length, i - 1));
  }
  return wynik;
}

test("pomocnicze testu: wycinanie funkcji i atrybutów odnośników działa na trudnych przypadkach", () => {
  assert.match(funkcja("wartoscMiesiaca"), /const m = /, "parametr z domyślnym obiektem");
  assert.match(funkcja("przelicz"), /zlozZgloszenie/, "parametr z domyślną wartością");
  assert.match(funkcja("wyslij"), /fetch\(/, "funkcja async");
  const repo = atrybutyOdnosnikow().find((a) => a.includes("ADRES_REPOZYTORIUM"));
  assert.match(repo, /rel: "noopener noreferrer"/, "atrybuty po wstawce ze zmienną");
  assert.doesNotMatch(KOD, /^\s*\/\//m, "bez linii komentarza");
  assert.match(KOD, /https:\/\/github\.com\//, "adres w tekście zostaje");
});

// Wyjątki: odnośnik do pobrania ZIP-a (download) i odnośnik mailto: na adresie po zapisie, który
// otwiera program poczty, a nie kartę (tak jak „Napisz nową wiadomość” w index.html).
test("odnośniki otwierają się w nowej karcie, żeby nie skasować danych z pamięci strony", () => {
  const odnosniki = atrybutyOdnosnikow().filter((a) => /href:/.test(a) && !/download/.test(a) && !/href: mailto\b/.test(a));
  assert.equal(odnosniki.length, 3, "odnośnik zgody, instrukcji pobrania i repozytorium");
  for (const a of odnosniki) {
    assert.match(a, /target:\s*"_blank"/, a);
    assert.match(a, /rel:\s*"noopener noreferrer"/, a);
  }
  assert.doesNotMatch(HTML, /<a\b(?![^>]*target="_blank")[^>]*href="(?:https?:|\/)/, "odnośniki w index.html");
});

test("krok 6: żądanie dokładnie w ustalonej postaci, z limitem czasu CZAS_WYSYLKI_MS (60 s, test wysylka.test.mjs)", () => {
  const wysylka = funkcja("wyslij");
  assert.match(wysylka, /fetch\("\/zgloszenie\/", \{\n\s*method: "POST",\n\s*body: gotowy\.bajty,\n\s*headers: \{ "Content-Type": "application\/zip", "X-Numer": NUMER, "X-Adres": adres\.adres \},\n\s*credentials: "omit",\n\s*cache: "no-store",\n\s*redirect: "error",\n\s*signal: kontroler\.signal,\n\s*\}\)/);
  assert.match(wysylka, /const kontroler = new AbortController\(\);/);
  assert.match(wysylka, /setTimeout\(\(\) => kontroler\.abort\(\), CZAS_WYSYLKI_MS\)/);
  assert.match(wysylka, /clearTimeout\(limit\);/);
  // Adres sprawdzony przed żądaniem; zły adres: tekst przy polu, bez żądania.
  const sprawdzenie = wysylka.indexOf("sprawdzAdres(");
  assert.ok(sprawdzenie > 0 && sprawdzenie < wysylka.indexOf("fetch("));
  assert.match(wysylka, /if \(!adres\.ok\) \{\n\s*pokazBladAdresu\(true\);/);
  // Odpowiedź zamienia na tekst moduł wysylka.js (testy jednostkowe).
  assert.match(wysylka, /wynikWysylki\(odpowiedz\)/);
  assert.match(KOD, /import \{[^}]*\bwynikWysylki\b[^}]*\} from "\.\/lib\/wysylka\.js"/);
  // W trakcie: przycisk nieaktywny z napisem wysylka_trwa.
  assert.match(funkcja("pokazWysylke"), /przycisk\.textContent = t\(wysylkaTrwa \? "wysylka_trwa" : "wysylka_przycisk"\);/);
  assert.match(funkcja("pokazWysylke"), /przycisk\.disabled = !gotowy \|\| zaDuzy \|\| wysylkaTrwa;/);
});

test("krok 6: wysyłka tylko pod https: i pod http: na 127.0.0.1 i localhost; inaczej droga zapasowa", () => {
  assert.match(MAIN, /\nconst WYSYLKA_DOSTEPNA = wysylkaDostepna\(location\.protocol, location\.hostname\);/);
  const pokaz6 = funkcja("pokazWysylke");
  assert.match(pokaz6, /pokaz\(\$\("#wysylka-formularz"\), WYSYLKA_DOSTEPNA\);/);
  assert.match(pokaz6, /pokaz\(\$\("#wysylka-niedostepna"\), !WYSYLKA_DOSTEPNA\);/);
  assert.match(pokaz6, /pokaz\(\$\("#widok-zapasowa"\), widok6 === "zapasowa" \|\| \(widok6 === "wysylka" && !WYSYLKA_DOSTEPNA\)\);/);
  assert.match(pokaz6, /pokaz\(\$\("#zapasowa-wroc"\), WYSYLKA_DOSTEPNA\);/);
});

test("bez kopiowania adresu, schowka i udostępniania przez okno systemowe", () => {
  for (const [nazwa, tresc] of [["main.js", MAIN], ["index.html", HTML], ["style.css", CSS]]) {
    assert.doesNotMatch(tresc, /kopiuj/i, nazwa);
    assert.doesNotMatch(tresc, /udostepn|droga-zapis-pokaz|canShare|clipboard/i, `${nazwa}: droga z udostępnianiem znika`);
  }
});

test("adres e-mail: Enter w polu niczego nie wysyła, wysyłkę zaczyna tylko przycisk", () => {
  assert.doesNotMatch(KOD, /keydown|keyup|keypress/, "bez obsługi klawiszy");
  assert.doesNotMatch(KOD, /"Enter"/);
  // Pole adresu nie leży w formularzu HTML, więc Enter nie wysyła go też sam.
  assert.doesNotMatch(HTML, /<form\b/);
  assert.equal((KOD.match(/\bwyslij\)/g) ?? []).length, 1, "wyslij podpięte tylko pod kliknięcie przycisku");
  assert.match(KOD, /\$\("#wyslij"\)\.addEventListener\("click", wyslij\);/);
});

test("wysyłka: funkcja sama sprawdza, czy wysyłka jest dostępna, zanim cokolwiek zrobi", () => {
  const wysylka = funkcja("wyslij");
  const pierwsza = wysylka.trim().split("\n")[0];
  assert.equal(pierwsza, "if (!wysylkaDostepna(location.protocol, location.hostname)) return;");
  assert.ok(wysylka.indexOf("wysylkaDostepna(") < wysylka.indexOf("fetch("));
});

// Straże przed nieaktualnym ZIP-em. Wynik starszej budowy nie trafia do pamięci, a zapis i wysyłka
// biorą plik tylko z aktualnyZip(), który nie oddaje ZIP-a po zmianie danych. Każda z dwóch
// straży osobno jest zbędna; razem chronią przed wyścigiem kompresji ze zmianą pola.
test("nieaktualny ZIP: zbudujZip odrzuca wynik starszej budowy, aktualnyZip go nie oddaje, zapis i wysyłka biorą plik z aktualnyZip()", () => {
  assert.match(funkcja("zbudujZip"), /if \(wynik !== budowany \|\| czekaPrzeliczenie\) return;\n\s*zip = \{ wynik: budowany, bajty \};/);
  assert.match(funkcja("aktualnyZip"), /return zip && zip\.wynik === wynik && !czekaPrzeliczenie \? zip : null;/);
  assert.match(funkcja("zapisz"), /const gotowy = aktualnyZip\(\);/);
  assert.match(funkcja("wyslij"), /const gotowy = aktualnyZip\(\);/);
  assert.match(funkcja("wyslij"), /body: gotowy\.bajty,/);
  assert.doesNotMatch(MAIN, /\bzip\.bajty\b/, "nikt nie czyta pamięci ZIP-a z pominięciem aktualnyZip()");
});
