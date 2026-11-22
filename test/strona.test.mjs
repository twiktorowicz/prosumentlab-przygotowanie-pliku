// Sprawdzenia statyczne strony (app/main.js, app/index.html), których nie obejmuje N21.
// Zachowanie w przeglądarce sprawdza narzedzia/proba-przegladarki.mjs (poza node --test).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ROK_MIN, ROK_MAKS } from "../app/lib/kalendarz.js";

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

test("ZIP powstaje w jednym miejscu (zbudujZip), po wejściu na krok 5 i po zmianie danych na krokach 5–6", () => {
  assert.equal((MAIN.match(/\butworzZipZgloszenia\s*\(/g) ?? []).length, 1);
  const budowa = funkcja("zbudujZip");
  assert.match(budowa, /utworzZipZgloszenia\(budowany\)/);
  // Wynik trafia do pamięci tylko wtedy, gdy dane się w tym czasie nie zmieniły.
  assert.match(budowa, /if \(wynik !== budowany \|\| czekaPrzeliczenie\) return;/);
  assert.match(funkcja("pokazKrok"), /if \(n >= 5\) zbudujZip\(\);/, "wejście na krok 5 i 6");
  assert.match(funkcja("przelicz"), /if \(aktualnyKrok >= 5\) zbudujZip\(\);/, "zmiana danych na kroku 5");
  // Każda zmiana danych unieważnia ZIP: przeliczenie i zmiana czekająca na przeliczenie.
  assert.match(funkcja("przelicz"), /uniewaznijZip\(\);/);
  assert.match(funkcja("przeliczPozniej"), /uniewaznijZip\(\);/);
  assert.match(funkcja("uniewaznijZip"), /zip = null;/);
  assert.doesNotMatch(MAIN, /wynik\.zip\b/);
});

test("zapis, odnośnik i wysyłka używają gotowego ZIP-a: bez czekania na kompresję po kliknięciu", () => {
  // Ten sam ZIP z pamięci (aktualnyZip) w zapisie i wysyłce; przed pobraniem pliku i przed
  // żądaniem nie ma żadnego await.
  const zapis = funkcja("zapisz");
  assert.doesNotMatch(MAIN, /\nasync function zapisz\(/, "zapis nie jest asynchroniczny");
  assert.match(zapis, /const gotowy = aktualnyZip\(\);/);
  assert.doesNotMatch(zapis, /\bawait\b/);
  const wysylka = funkcja("wyslij");
  assert.match(wysylka, /const gotowy = aktualnyZip\(\);/);
  const przedZadaniem = wysylka.slice(0, wysylka.indexOf("const o = await fetch("));
  assert.ok(przedZadaniem.length > 0);
  assert.doesNotMatch(przedZadaniem, /\bawait\b/, "przed żądaniem bez await");
  assert.match(wysylka, /body: gotowy\.bajty,/);
  assert.match(funkcja("aktualnyZip"), /zip && zip\.wynik === wynik && !czekaPrzeliczenie \? zip : null/);
});

test("pliki przetwarzane raz: strona nie woła przygotujZgloszenie, tylko przygotujPliki i zlozZgloszenie", () => {
  assert.doesNotMatch(MAIN, /\bprzygotujZgloszenie\s*\(/);
  assert.equal((MAIN.match(/\bprzygotujPliki\s*\(/g) ?? []).length, 1, "przygotujPliki w jednym miejscu (zmiana listy plików)");
  assert.match(MAIN, /\bzlozZgloszenie\s*\(/);
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

test("nagłówek kreatora: napis ProsumentLab (odnośnik do / w nowej karcie), napis z numerem kroku, pasek postępu dla oka", () => {
  const naglowek = /<header class="naglowek">([\s\S]*?)<\/header>/.exec(HTML)[1];
  assert.match(naglowek, /<a class="marka" href="\/" target="_blank" rel="noopener noreferrer" data-tekst="naglowek_marka"><\/a>\s*<span class="kreator-krok" id="kreator-krok"><\/span>/);
  // Pasek z sześcioma odcinkami, ukryty przed czytnikiem ekranu: informację niesie napis.
  const pasek = /<div class="pasek" id="pasek" aria-hidden="true">([\s\S]*?)<\/div>/.exec(naglowek);
  assert.ok(pasek, "pasek postępu");
  assert.equal((pasek[1].match(/<span><\/span>/g) ?? []).length, 6);
  assert.match(funkcja("pokazKrok"), /\$\("#kreator-krok"\)\.textContent = t\("kreator_krok", \{ n, m: KROKI \}\);/);
  // Wstęp i akapit o operatorze w kroku 1, pod tytułem kroku.
  assert.match(sekcja("krok-pliki"), /<p class="wstep" data-tekst="wstep_opis"><\/p>\s*<p class="drobny" data-tekst="wstep_operator"><\/p>/);
  assert.equal((HTML.match(/href="\/"/g) ?? []).length, 2, "napis w nagłówku i przycisk po wysłaniu");
});

// Treść sekcji kroku o danym id.
function sekcja(id) {
  const m = new RegExp(`<section class="krok" id="${id}"[^>]*>([\\s\\S]*?)</section>`).exec(HTML);
  assert.ok(m, id);
  return m[1];
}

const KROKI = [
  ["krok-pliki", "krok_pliki"], ["krok-faktura", "krok_faktura"], ["krok-cena", "krok_cena"],
  ["krok-dodatkowe", "krok_dodatkowe"], ["krok-sprawdzenie", "krok_sprawdzenie"], ["krok-wysylka", "krok_wysylka"],
];

test("kreator: sześć kroków na jednej stronie, widoczny pierwszy; nagłówek kroku z tabindex=-1", () => {
  const sekcje = [...HTML.matchAll(/<section class="krok" id="([a-z-]+)" data-krok="(\d)"( hidden)?>\s*<h1 tabindex="-1"[^>]*data-tekst="([a-z_]+)"><\/h1>/g)];
  assert.deepEqual(sekcje.map((m) => [m[1], m[4]]), KROKI);
  assert.deepEqual(sekcje.map((m) => m[2]), ["1", "2", "3", "4", "5", "6"]);
  assert.deepEqual(sekcje.map((m) => Boolean(m[3])), [false, true, true, true, true, true], "na starcie widoczny tylko krok 1");
  assert.equal((HTML.match(/<section /g) ?? []).length, 6);
  assert.match(MAIN, /\nconst KROKI = 6;/);
  // Bez panelu bocznego: jego treść jest w rozwijanej części kroku 1.
  assert.doesNotMatch(HTML, /<aside/);
  assert.match(sekcja("krok-pliki"), /<details class="panel">\s*<summary data-tekst="panel_pokaz"><\/summary>\s*<h2 data-tekst="panel_zostaje_tytul"><\/h2>\s*<ul data-tekst="panel_zostaje_lista"><\/ul>\s*<h2 data-tekst="panel_trafia_tytul"><\/h2>\s*<ul data-tekst="panel_trafia_lista"><\/ul>\s*<\/details>/);
  assert.doesNotMatch(HTML, /panel_uwaga|krok_zakres|krok_instalacja|krok_zgoda|krok_zapis|wstep_tytul/);
});

test("kreator: pod krokiem „Wstecz” (od kroku 2) i „Dalej” (kroki 1–5), pasek nie jest przyklejony", () => {
  assert.match(HTML, /<\/main>\s*<div class="tresc kreator-przyciski" id="kreator-przyciski">\s*<button type="button" class="przycisk przycisk-drugi" id="kreator-wstecz" data-tekst="kreator_wstecz" hidden><\/button>\s*<button type="button" class="przycisk" id="kreator-dalej" data-tekst="kreator_dalej"><\/button>\s*<\/div>/);
  const krok = funkcja("pokazKrok");
  assert.match(krok, /pokaz\(\$\("#kreator-wstecz"\), n > 1 && widok6 !== "wyslane"\);/);
  assert.match(krok, /pokaz\(\$\("#kreator-dalej"\), n < KROKI\);/);
  assert.doesNotMatch(CSS, /position:\s*(?:sticky|fixed)/, "nic nie jest przyklejone do ekranu");
});

test("kreator: przejście przewija na górę i daje fokus nagłówkowi kroku; bez historii przeglądarki", () => {
  const krok = funkcja("pokazKrok");
  assert.match(krok, /for \(const s of \$\$\("section\.krok"\)\) pokaz\(s, s\.dataset\.krok === String\(n\)\);/);
  assert.match(krok, /window\.scrollTo\(0, 0\);/);
  assert.match(krok, /\$\("h1", sekcjaKroku\(n\)\)\.focus\(\{ preventScroll: true \}\);/);
  assert.doesNotMatch(MAIN, /\bhistory\./);
});

test("„Dalej”: sprawdza tylko bieżący krok, „Wstecz” niczego nie sprawdza i nie kasuje", () => {
  const dalej = funkcja("dalej");
  assert.match(dalej, /if \(czekaPrzeliczenie\) przelicz\(\);/, "najpierw zmiana czekająca na przeliczenie");
  assert.match(dalej, /const blad = bladKroku\(aktualnyKrok\);/);
  assert.match(dalej, /pokazKrok\(aktualnyKrok \+ 1\);/);
  const wstecz = funkcja("wstecz");
  assert.equal(wstecz.trim(), "pokazKrok(aktualnyKrok - 1);");
  const blad = funkcja("bladKroku");
  // Krok 1: przyjęty plik i brak blokad plików; kroki 2–4: błędy pól w tym kroku; krok 5 bez
  // warunków.
  assert.match(blad, /t\("kreator_pliki_brak"\)/);
  assert.match(blad, /t\("kreator_popraw", \{ pola: /);
  assert.match(blad, /if \(n >= 2 && n <= 4\)/);
  assert.doesNotMatch(blad, /brakujace|FAKTURA_BRAK_OBOWIAZKOWYCH/, "brak danych obowiązkowych nie zatrzymuje");
  // Odczyt pliku w toku: „Dalej” nieaktywne.
  assert.match(funkcja("ustawBlokadeOdczytu"), /\$\("#kreator-dalej"\)\.disabled = czytanie && aktualnyKrok === 1;/);
});

test("komunikat kreatora w każdym z kroków 1–4, pod nagłówkiem, z fokusem na pierwszym błędnym polu", () => {
  for (const [id] of KROKI.slice(0, 4)) {
    assert.match(sekcja(id), /^\s*<h1 tabindex="-1" data-tekst="[a-z_]+"><\/h1>\s*<p class="blad kreator-komunikat" tabindex="-1" role="alert" hidden><\/p>/, id);
  }
  for (const [id] of KROKI.slice(4)) assert.doesNotMatch(sekcja(id), /kreator-komunikat/, id);
  assert.match(funkcja("dalej"), /blad\.fokus\.focus\(\);/);
});

test("ostrzeżenie przed opuszczeniem strony: wczytane pliki, zgłoszenie niewysłane i niezapisane", () => {
  const ostrzez = funkcja("ustawOstrzezenie");
  assert.match(ostrzez, /const potrzebne = pliki\.length > 0 && !oddane;/);
  assert.match(ostrzez, /addEventListener\("beforeunload", ostrzezPrzedWyjsciem\)/);
  assert.match(ostrzez, /removeEventListener\("beforeunload", ostrzezPrzedWyjsciem\)/);
  assert.match(funkcja("ostrzezPrzedWyjsciem"), /z\.preventDefault\(\);/);
  assert.match(funkcja("zapisz"), /oddane = true;/);
  assert.match(funkcja("wyslij"), /oddane = true;/);
  assert.match(funkcja("uniewaznijZip"), /oddane = false;/, "nowe dane: zapisany albo wysłany ZIP już im nie odpowiada");
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

test("G12, G12w i G13 przy cenie stałej: pola stref od razu, bez wyboru, pod nimi cena_strefy_jedna; wybór tylko przy „inna”", () => {
  const blok = blokPola("cena_energii_netto_zl_kwh");
  assert.match(blok, /<div class="pola-stref" id="cena-pola"><\/div>\s*<p class="podpowiedz" id="cena-strefy-jedna" data-tekst="cena_strefy_jedna" hidden><\/p>/);
  const wybor = funkcja("wyborStref");
  assert.match(wybor, /const znane = stala && \(STREFY\[taryfa\] \?\? 0\) > 1;/, "znana liczba stref większa niż 1");
  assert.match(wybor, /const wyborTrybu = stala && taryfa === "inna";/, "wybór jednej ceny tylko przy „inna”");
  assert.match(wybor, /strefy: znane \|\| \(wyborTrybu && wybrane\("cena_tryb"\) === "strefy"\)/);
  const budowa = funkcja("zbudujPolaCen");
  assert.match(budowa, /pokaz\(\$\("#cena-tryb"\), wyborTrybu\);/);
  assert.match(budowa, /pokaz\(\$\("#cena-strefy-jedna"\), znane\);/);
});

test("nazwy stref: G12w ma własne (strefy_g12w), G12 i G13 bez zmian", () => {
  const nazwy = funkcja("nazwyStref");
  assert.match(nazwy, /if \(taryfa === "g12"\) return TEKSTY\.strefy_g12;/);
  assert.match(nazwy, /if \(taryfa === "g12w"\) return TEKSTY\.strefy_g12w;/);
  assert.match(nazwy, /if \(taryfa === "g13"\) return TEKSTY\.strefy_g13;/);
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
  // Sprawdzane w kodzie bez komentarzy, żeby wzmianka w komentarzu nie zastąpiła kodu.
  assert.match(KOD, /import \{[^}]*\bMAKS_PLIKOW\b[^}]*\} from "\.\/lib\/zgloszenie\.js"/, "limit z modułu zgłoszenia");
  assert.match(KOD, /pliki\.slice\(0, MAKS_PLIKOW\)/, "odczyt tylko pierwszej dziesiątki");
  assert.match(KOD, /if \(i >= MAKS_PLIKOW\) return \{ stan: "odrzucony", kod: "blad_za_duzo_plikow" \}/);
  assert.match(KOD, /\$\("#wybor-plikow"\)\.disabled = czytanie/, "pole wyboru plików nieaktywne w trakcie odczytu");
  assert.match(KOD, /arrayBuffer\(\)/);
  // Etykieta-przycisk „Dodaj plik” wygląda na nieaktywną, gdy pole wyboru jest zablokowane.
  assert.match(HTML, /<input class="ukryte-pole" type="file" id="wybor-plikow"[^>]*>\s*<label class="przycisk przycisk-drugi" for="wybor-plikow"/);
  assert.match(CSS, /\.przycisk:disabled, \.przycisk\[aria-disabled="true"\], \.ukryte-pole:disabled \+ \.przycisk \{/);
});

// Fragment index.html od elementu z data-pole="nazwa" do następnego pola albo końca sekcji.
function blokPola(nazwa) {
  const i = HTML.indexOf(`data-pole="${nazwa}"`);
  assert.ok(i > 0, nazwa);
  const reszta = HTML.slice(i + 1);
  const koniec = reszta.search(/data-pole="|<\/section>/);
  return reszta.slice(0, koniec);
}

test("krok 2 „Faktura” i krok 3 „Cena energii”: pola w kolejności pytań, tytuł kroku zamiast nagłówków grup", () => {
  const faktura = sekcja("krok-faktura");
  assert.ok(faktura.indexOf('data-tekst="faktura_wstep"') < faktura.indexOf("data-pole="), "wstęp przed polami");
  assert.deepEqual([...faktura.matchAll(/data-pole="([a-z_]+)"/g)].map((m) => m[1]), [
    "system_rozliczenia", "sprzedawca", "sprzedawca_nazwa", "okres_miesiac", "okres_od", "okres_do", "rodzaj_faktury",
  ]);
  const cena = sekcja("krok-cena");
  assert.deepEqual([...cena.matchAll(/data-pole="([a-z_]+)"/g)].map((m) => m[1]), [
    "rodzaj_ceny", "taryfa", "taryfa_nazwa", "cena_energii_netto_zl_kwh", "oplata_mocowa_zl_mies", "oplata_abonamentowa_zl_mies",
    "oplata_stala_sieciowa_zl_mies", "oplata_przejsciowa_zl_mies", "oplaty_stale_inne",
  ]);
  // Rysunek faktury rozwijany, pod wstępem, przed pierwszym polem. Napis rozwijania to
  // faktura_rysunek_pokaz; faktura_rysunek_opis zostaje opisem rysunku dla czytnika ekranu.
  assert.match(faktura, /<p data-tekst="faktura_wstep"><\/p>\s*<details class="rysunek-pokaz">\s*<summary data-tekst="faktura_rysunek_pokaz"><\/summary>\s*<figure class="rysunek">/);
  assert.equal((HTML.match(/faktura_rysunek_opis/g) ?? []).length, 0, "opis rysunku nie jest napisem w HTML");
  assert.equal((MAIN.match(/"faktura_rysunek_opis"/g) ?? []).length, 1);
  assert.match(funkcja("wstawTeksty"), /\$\("#rysunek-faktury"\)\.setAttribute\("aria-label", t\("faktura_rysunek_opis"\)\);/);
  assert.match(faktura, /<\/figure>\s*<\/details>\s*<fieldset class="pole" data-pole="system_rozliczenia"/);
  assert.doesNotMatch(HTML, /faktura_grupa_/, "tytuły kroków zastępują nagłówki grup");
  assert.doesNotMatch(HTML, /operator_dystrybucyjny|pierwsze_oddanie/, "bez pytań o operatora i pierwsze oddanie");
});

test("system opustów chowa wszystkie pola faktury poza systemem rozliczenia; krok 3 mówi wtedy, że pól nie trzeba wpisywać", () => {
  const faktura = /<div id="faktura-pola" data-warunek="system_rozliczenia!=opusty">([\s\S]*)<\/div>\s*$/.exec(sekcja("krok-faktura"));
  assert.ok(faktura, "kontener z warunkiem w kroku 2, do końca kroku");
  assert.doesNotMatch(faktura[1], /data-pole="system_rozliczenia"/);
  assert.match(faktura[1], /data-pole="sprzedawca"/);
  assert.match(faktura[1], /data-pole="rodzaj_faktury"/);
  const cena = /<p class="uwaga" data-tekst="faktura_opusty" data-warunek="system_rozliczenia=opusty" hidden><\/p>\s*<div id="cena-kontener" data-warunek="system_rozliczenia!=opusty">([\s\S]*)<\/div>\s*<p class="uwaga" id="faktura-brak" hidden><\/p>\s*$/.exec(sekcja("krok-cena"));
  assert.ok(cena, "krok 3: tekst o opustach, pola z warunkiem, na końcu uwaga o brakujących polach");
  assert.match(cena[1], /data-pole="rodzaj_ceny"/);
  assert.match(cena[1], /data-pole="oplaty_stale_inne"/);
  assert.match(MAIN, /\(!\?=\)/, "warunki() rozumie „pole!=wartość”");
});

test("korekta jako pole wyboru, opłaty stałe w zwiniętym <details>", () => {
  assert.match(blokPola("rodzaj_faktury"), /<input type="checkbox" id="p-korekta">/);
  assert.match(blokPola("rodzaj_faktury"), /data-tekst="faktura_korekta_pole"/);
  const oplaty = /<details class="oplaty">([\s\S]*?)<\/details>/.exec(HTML);
  assert.ok(oplaty, "sekcja opłat stałych");
  assert.match(oplaty[0], /^<details class="oplaty">\s*<summary data-tekst="faktura_oplaty"><\/summary>\s*<p[^>]*data-tekst="faktura_oplaty_wstep"/);
  for (const pole of ["oplata_mocowa_zl_mies", "oplata_abonamentowa_zl_mies", "oplata_stala_sieciowa_zl_mies", "oplata_przejsciowa_zl_mies", "oplaty_stale_inne"]) {
    assert.match(oplaty[1], new RegExp(`data-pole="${pole}"`), pole);
  }
});

test("„Co to znaczy?”: zwinięte <details> pod etykietą pięciu pól", () => {
  const POMOC = /<details class="pomoc">\s*<summary data-tekst="co_to_znaczy"><\/summary>/;
  for (const [pole, klucze] of [
    ["system_rozliczenia", ["pomoc_system"]], ["taryfa", ["pomoc_taryfa"]], ["rodzaj_ceny", ["pomoc_rodzaj_ceny"]],
    ["cena_energii_netto_zl_kwh", ["pomoc_cena_stala", "pomoc_cena_dynamiczna"]],
  ]) {
    const blok = blokPola(pole);
    assert.match(blok, /<\/legend>\s*<details class="pomoc">/, `${pole}: pod etykietą`);
    assert.match(blok, POMOC, pole);
    for (const k of klucze) assert.match(blok, new RegExp(`data-tekst="${k}"`), `${pole}: ${k}`);
  }
  // Okres to lista miesiąca albo dwie daty, więc podpowiedź stoi pod całą grupą, po polu wyboru.
  assert.match(HTML, /<\/label>\s*<details class="pomoc">\s*<summary data-tekst="co_to_znaczy"><\/summary>\s*<p data-tekst="pomoc_okres"><\/p>/);
  assert.equal((HTML.match(/<details class="pomoc">/g) ?? []).length, 5);
  assert.doesNotMatch(HTML, /<details[^>]*\bopen\b/, "domyślnie zwinięte");
});

test("numery przy polach jak na rysunku, ukryte przed czytnikiem ekranu", () => {
  const NUMERY = {
    rodzaj_faktury: 1, okres_miesiac: 2, okres_od: 2, okres_do: 2, sprzedawca: 3, taryfa: 4, system_rozliczenia: 5, cena_energii_netto_zl_kwh: 6,
    oplaty_stale_inne: 7, oplata_mocowa_zl_mies: 8, oplata_abonamentowa_zl_mies: 9, oplata_stala_sieciowa_zl_mies: 10,
    oplata_przejsciowa_zl_mies: 11, rodzaj_ceny: 12,
  };
  for (const [pole, nr] of Object.entries(NUMERY)) {
    const znaczki = [...blokPola(pole).matchAll(/<span class="nr"([^>]*)>(\d+)<\/span>/g)];
    assert.equal(znaczki.length, 1, pole);
    assert.equal(znaczki[0][2], String(nr), pole);
    assert.equal(znaczki[0][1], ' aria-hidden="true"', pole);
  }
  assert.equal((HTML.match(/<span class="nr"/g) ?? []).length, Object.keys(NUMERY).length);
});

test("cena dynamiczna: jedno pole bez stref, własna etykieta i podpowiedź", () => {
  const blok = blokPola("cena_energii_netto_zl_kwh");
  assert.match(blok, /data-tekst="faktura_cena" data-warunek="rodzaj_ceny!=dynamiczna"/);
  assert.match(blok, /data-tekst="faktura_cena_dynamiczna" data-warunek="rodzaj_ceny=dynamiczna"/);
  assert.match(blok, /data-tekst="faktura_cena_kilka" data-warunek="rodzaj_ceny!=dynamiczna"/);
  assert.match(MAIN, /wybrane\("rodzaj_ceny"\) !== "dynamiczna"/, "strefy tylko przy cenie stałej");
});

test("okres faktury: domyślnie miesiąc z dwóch list, pole wyboru odsłania dwie daty", () => {
  const miesiac = blokPola("okres_miesiac");
  assert.match(HTML, /<fieldset class="pole" data-pole="okres_miesiac">/);
  // Lista miesięcy z pliku (schowana bez pełnego miesiąca), pod nią dwie listy i podpowiedź.
  assert.match(miesiac, /<legend><span class="nr" aria-hidden="true">2<\/span><span id="faktura-miesiac-etykieta" data-tekst="faktura_miesiac"><\/span><\/legend>\s*<select id="p-okres-lista" aria-labelledby="faktura-miesiac-etykieta" aria-describedby="faktura-miesiac-pomoc" hidden><\/select>\s*<div class="miesiac-rok" data-miesiac="okres_miesiac"><\/div>\s*<p class="podpowiedz" id="faktura-miesiac-pomoc" data-tekst="faktura_miesiac_pomoc" hidden><\/p>\s*<p class="blad" hidden><\/p>/);
  // Dwie daty schowane na starcie, w jednym kontenerze, tuż za polem miesiąca.
  assert.match(HTML, /<\/fieldset>\s*<div class="pole-para" id="okres-daty" hidden>\s*<div class="pole" data-pole="okres_od">/);
  assert.match(HTML, /<label class="opcja"><input type="checkbox" id="p-okres-inny"><span data-tekst="faktura_inny_okres"><\/span><\/label>/);
  assert.ok(HTML.indexOf('id="okres-daty"') < HTML.indexOf('id="p-okres-inny"'), "pole wyboru pod polami okresu");
  // Lata od bieżącego do 2022 (początek net-billingu); magazyn i zmiany dalej od 2010.
  assert.match(MAIN, /\nconst ROK_FAKTURY_OD = 2022;/);
  assert.match(MAIN, /listyMiesiacaIRoku\("okres_miesiac", ROK_FAKTURY_OD\)/);
  assert.match(funkcja("listyMiesiacaIRoku"), /for \(let r = rokBiezacy; r >= rokOd; r--\)/);
  // Przełączanie tylko chowa pola: wartości zostają, a do modułu trafia miesiąc albo daty.
  const war = funkcja("warunki");
  assert.match(war, /pokaz\(\$\("#okres-daty"\), innyOkres\)/);
  assert.match(war, /pokaz\(\$\('\[data-pole="okres_miesiac"\]'\), !innyOkres\)/);
  const zbierz = funkcja("zbierzFormularz");
  assert.match(zbierz, /okres_miesiac: innyOkres \? "" : wartoscMiesiacaFaktury\(\{ niepelny: true \}\)/);
  assert.match(zbierz, /okres_od: innyOkres \? wartoscPola\("okres_od"\) : ""/);
  assert.match(zbierz, /okres_do: innyOkres \? wartoscPola\("okres_do"\) : ""/);
  assert.doesNotMatch(war, /\.value\s*=/, "przełączanie nie czyści pól");
});

test("miesiąc faktury z listy pełnych miesięcy z plików: pusta pozycja, miesiące od najnowszego, „inny miesiąc”", () => {
  // Lista budowana po każdej zmianie listy plików, z modułu zakresu (bez liczenia miesięcy tutaj).
  assert.match(KOD, /import \{[^}]*\bmiesiaceFaktury\b[^}]*\} from "\.\/lib\/zakres\.js"/);
  assert.match(funkcja("przeliczPliki"), /\n  zbudujListeMiesiecy\(\);$/, "na końcu przeliczenia plików");
  assert.equal((KOD.match(/\bmiesiaceFaktury\(/g) ?? []).length, 1);
  const budowa = funkcja("zbudujListeMiesiecy");
  assert.match(budowa, /miesiaceZPliku = miesiaceFaktury\(przygotowane\.analiza, \{ odRoku: ROK_FAKTURY_OD, doRoku: rokBiezacy \}\);/, "lata jak w dwóch listach");
  // Kolejność pozycji: pusta (bez wyboru z góry), miesiące, „inny miesiąc” na końcu.
  const opcje = /lista\.replaceChildren\(([\s\S]*?)\n  \);/.exec(budowa);
  assert.ok(opcje, "pozycje listy");
  const wybierz = opcje[1].indexOf('el("option", { value: "", tekst: t("faktura_miesiac_wybierz") })');
  const miesiace = opcje[1].indexOf("...miesiaceZPliku.map((m) => el(\"option\", { value: m.wartosc, tekst: miesiacSlownie(m.rok, m.miesiac) }))");
  const inny = opcje[1].indexOf('el("option", { value: INNY_MIESIAC, tekst: t("faktura_miesiac_inny") })');
  assert.ok(wybierz >= 0 && wybierz < miesiace && miesiace < inny, opcje[1]);
  assert.match(MAIN, /\nconst INNY_MIESIAC = "inny";/);
  // Miesiąc słownie z rokiem, bez „r.”, w tej samej postaci co w tabeli miesięcy podglądu
  // („październik 2025”).
  assert.match(funkcja("miesiacSlownie"), /return `\$\{TEKSTY\.miesiace_mianownik\[miesiac - 1\]\} \$\{rok\}`;/);
  assert.match(funkcja("pokazPodglad"), /`\$\{TEKSTY\.miesiace_mianownik\[m\.miesiac - 1\]\} \$\{m\.rok\}`/);
});

test("miesiąc faktury: lista z podpowiedzią tylko przy pełnych miesiącach, dwie listy bez nich albo przy „inny miesiąc”", () => {
  const war = funkcja("warunki");
  assert.match(war, /const zPliku = miesiaceZPliku\.length > 0;/);
  assert.match(war, /pokaz\(\$\("#p-okres-lista"\), zPliku\);/);
  assert.match(war, /pokaz\(\$\("#faktura-miesiac-pomoc"\), zPliku\);/);
  assert.match(war, /pokaz\(\$\('\[data-miesiac="okres_miesiac"\]'\), !zPliku \|\| wybranoInny\(\)\);/);
  // Wartość: z listy, a przy „inny miesiąc” albo bez listy z dwóch list (także niepełny wybór,
  // który moduł formularza zgłasza jako błąd).
  const wartosc = funkcja("wartoscMiesiacaFaktury");
  assert.match(wartosc, /if \(miesiaceZPliku\.length > 0 && !wybranoInny\(\)\) return \$\("#p-okres-lista"\)\.value;/);
  assert.match(wartosc, /return wartoscMiesiaca\(\$\('\[data-miesiac="okres_miesiac"\]'\), \{ niepelny \}\);/);
  assert.match(MAIN, /const wybranoInny = \(\) => \$\("#p-okres-lista"\)\.value === INNY_MIESIAC;/);
});

test("miesiąc faktury: zmiana listy plików nie gubi wyboru", () => {
  const budowa = funkcja("zbudujListeMiesiecy");
  // Miesiąc z listy, którego na nowej liście nie ma (albo listy już nie ma): te same miesiąc i rok
  // w dwóch listach, na liście pozycja „inny miesiąc”.
  assert.match(budowa, /if \(zListy && !naLiscie\) ustawDwieListy\(dwie, zListy\);/);
  assert.match(budowa, /else if \(naLiscie\) lista\.value = zListy;/);
  assert.match(budowa, /else lista\.value = poprzedni === "" \? "" : INNY_MIESIAC;/);
  // Lista pojawia się po wyborze w dwóch listach: wybór zostaje jako „inny miesiąc”.
  assert.match(budowa, /else if \(!byla\) lista\.value = wartoscMiesiaca\(dwie, \{ niepelny: true \}\) \? INNY_MIESIAC : "";/);
  // Lista znika przy pustej pozycji: dwie listy też bez wyboru (schowane wartości nie obowiązywały).
  assert.match(budowa, /if \(byla && !jest && poprzedni === ""\) ustawDwieListy\(dwie, ""\);/);
  const ustaw = funkcja("ustawDwieListy");
  assert.match(ustaw, /\$\('\[data-czesc="miesiac"\]', kontener\)\.value = m;/);
  assert.match(ustaw, /\$\('\[data-czesc="rok"\]', kontener\)\.value = r;/);
  // „Wstecz” i „Dalej” nie przebudowują listy.
  assert.doesNotMatch(funkcja("dalej"), /zbudujListeMiesiecy/);
  assert.doesNotMatch(funkcja("pokazKrok"), /zbudujListeMiesiecy|ustawDwieListy/);
});

test("miesiąc faktury: błąd przy „inny miesiąc” daje fokus liście miesiąca z dwóch list, przy wyborze z listy liście z pliku", () => {
  const f = funkcja("poleDoFokusu");
  assert.match(f, /if \(pole === "okres_miesiac" && miesiaceZPliku\.length > 0 && wybranoInny\(\)\) return \$\('\[data-miesiac="okres_miesiac"\] \[data-czesc="miesiac"\]'\);/);
  assert.ok(f.indexOf('pole === "okres_miesiac"') < f.indexOf('$$("input, select", kontener)'), "przed ogólnym wyborem pola");
  // Lista z pliku stoi w polu przed dwiema listami, więc ogólny wybór (pierwsze widoczne pole)
  // trafia w nią, gdy wartość pochodzi z listy.
  const miesiac = blokPola("okres_miesiac");
  assert.ok(miesiac.indexOf('id="p-okres-lista"') < miesiac.indexOf('data-miesiac="okres_miesiac"'));
});

test("pojemność magazynu: uwaga pod polem przy „tak” i pustym polu, bez blokady zapisu", () => {
  assert.match(blokPola("magazyn_pojemnosc_kwh"), /<input type="text" id="p-magazyn_pojemnosc_kwh"[^>]*>\s*<p class="uwaga" id="pojemnosc-brak" data-tekst="instalacja_pojemnosc_brak" hidden><\/p>\s*<p class="blad" hidden><\/p>/);
  assert.match(funkcja("pokazPola"), /pokaz\(\$\("#pojemnosc-brak"\), wybrane\("magazyn"\) === "tak" && !wartoscPola\("magazyn_pojemnosc_kwh"\)\.trim\(\)\)/);
});

test("zakres przed dodaniem pliku: zakres_pusty", () => {
  assert.match(MAIN, /t\("zakres_pusty"\)/);
});

test("podgląd zwarty: wstęp, zgoda, lista plików z ZIP-a jako zwinięte <details>, osobno miesiące", () => {
  const podglad = funkcja("pokazPodglad");
  assert.doesNotMatch(podglad, /zdanieZNumerem/, "numer zgłoszenia tylko przy zgodzie i po zapisie");
  for (const k of ["podglad_wstep", "podglad_miesiace_tytul", "podglad_zgoda_tak", "podglad_zgoda_nie"]) assert.match(podglad, new RegExp(`"${k}"`), k);
  for (const k of ["podglad_plik", "podglad_lista_zip", "podglad_z_pliku"]) assert.doesNotMatch(MAIN, new RegExp(`"${k}"`), `${k}: tabela plików i lista na końcu znikają`);
  for (const k of ["opis_zgloszenie", "opis_faktury", "opis_instalacja", "opis_pomiary"]) assert.match(MAIN, new RegExp(`"${k}"`), k);
  assert.match(podglad, /wynik\.zawartosc\.map\(/, "pozycje w kolejności z ZIP-a");
  assert.match(podglad, /el\("details", \{ klasa: "plik-zip", "data-plik": /);
  assert.doesNotMatch(MAIN, /\bopen: true\b/, "domyślnie zwinięte");
});

test("podgląd: przeliczenie nie zwija pozycji rozwiniętej przez klienta", () => {
  const podglad = funkcja("pokazPodglad");
  const przed = podglad.indexOf("replaceChildren");
  assert.ok(przed > 0);
  assert.match(podglad.slice(0, przed), /\$\$\("#podglad details\[data-plik\]"\)\.filter\(\(d\) => d\.open\)/, "otwarte zapamiętane przed przebudową");
  assert.match(podglad.slice(przed), /\.open = true/, "i odtworzone po niej");
});

test("krok 1: odnośnik „jak go pobrać z eLicznika” do /jak-pobrac-dane-z-elicznika/ w nowej karcie", () => {
  assert.match(HTML, /<p data-tekst="pliki_wybor"><\/p>\s*<p id="plik-instrukcja"><\/p>/);
  assert.match(MAIN, /el\("a", \{ href: "\/jak-pobrac-dane-z-elicznika\/", target: "_blank", rel: "noopener noreferrer"/);
});

// Ciąg elementów index.html, przedzielonych tylko odstępami.
const ciag = (czesci) => new RegExp(czesci.map((s) => s.replace(/[()[\]?.*+^$|]/g, "\\$&")).join("\\s*"));

test("krok 5: podgląd z rozmiarem zgłoszenia, zgoda, numer", () => {
  assert.match(sekcja("krok-sprawdzenie"), ciag([
    '<h1 tabindex="-1" data-tekst="krok_sprawdzenie"></h1>',
    '<h2 data-tekst="podglad_tytul"></h2>',
    '<div id="podglad"></div>',
    '<p class="podglad-rozmiar" id="podglad-rozmiar" aria-live="polite" hidden></p>',
    '<div class="zgoda">',
  ]));
  // Ostatnia linia kroku, tuż nad przyciskami kreatora, krojem podpowiedzi: „Dalej” jeszcze
  // niczego nie wysyła (sprawdzenie_dalej).
  assert.match(HTML, /<span id="zgoda-wiecej"><\/span>\s*<\/div>\s*<p class="podpowiedz" data-tekst="zgoda_bez"><\/p>\s*<p class="numer" id="numer"><\/p>\s*<p class="podpowiedz" data-tekst="sprawdzenie_dalej"><\/p>\s*<\/section>/);
  assert.match(funkcja("pokazRozmiar"), /t\("podglad_rozmiar", \{ rozmiar: rozmiarDoWyswietlenia\(gotowy\.bajty\.length\) \}\)/);
});

test("krok 6: tytuł, powód blokady, wysyłka z polem adresu, ramką, przyciskiem i odnośnikiem do drogi zapasowej", () => {
  assert.match(sekcja("krok-wysylka"), ciag([
    '<h1 tabindex="-1" id="wysylka-tytul" data-tekst="krok_wysylka"></h1>',
    '<p class="uwaga" id="zapis-powod" aria-live="polite" hidden></p>',
    '<div id="widok-wysylka">',
    '<p class="uwaga" id="wysylka-niedostepna" data-tekst="wysylka_niedostepna" hidden></p>',
    '<div id="wysylka-formularz">',
    '<div class="pole" data-pole="adres">',
    '<label for="p-adres" data-tekst="wysylka_adres"></label>',
    '<input type="email" id="p-adres" autocomplete="email" inputmode="email" aria-describedby="adres-pomoc">',
    '<p class="podpowiedz" id="adres-pomoc" data-tekst="wysylka_adres_pomoc"></p>',
    '<p class="blad" id="adres-blad" data-tekst="wysylka_adres_blad" role="alert" hidden></p>',
    "</div>",
    '<p class="ramka" id="wysylka-co"></p>',
    '<p class="uwaga" id="wysylka-komunikat" role="alert" hidden></p>',
    '<button type="button" class="przycisk" id="wyslij" data-tekst="wysylka_przycisk"></button>',
    '<p class="podpowiedz" id="wysylka-czekanie" hidden></p>',
    "</div>",
    '<button type="button" class="przycisk-tekstowy" id="zapasowa-pokaz" data-tekst="wysylka_zapasowa_pokaz"></button>',
    "</div>",
    '<div id="widok-zapasowa" hidden>',
    '<h2 tabindex="-1" id="zapasowa-tytul" data-tekst="zapasowa_tytul"></h2>',
    '<div class="droga" id="droga-zapis">',
  ]));
  // Numer w ramce czcionką o stałej szerokości, jak w zdaniu z numerem.
  assert.match(funkcja("wstawTeksty"), /\$\("#wysylka-co"\)\.replaceChildren\(\.\.\.zdanieZNumerem\("wysylka_co"\)\);/);
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

test("krok 6: ZIP ponad limit wysyłki: przycisk nieaktywny, wysylka_za_duzy, droga zapasowa", () => {
  const pokaz6 = funkcja("pokazWysylke");
  assert.match(pokaz6, /const zaDuzy = Boolean\(gotowy\) && zipZaDuzy\(gotowy\.bajty\.length\);/);
  assert.match(pokaz6, /const klucz = zaDuzy \? "wysylka_za_duzy" : bladWysylki;/);
});

test("ekran po wysłaniu: numer dużym krojem, adres, ramka z powrotem do kroku 6, pytanie, przycisk na stronę", () => {
  assert.match(sekcja("krok-wysylka"), ciag([
    '<div id="widok-wyslane" hidden>',
    '<h1 tabindex="-1" id="wyslane-tytul" data-tekst="wyslane_tytul"></h1>',
    '<div class="ramka-numer">',
    '<span data-tekst="wyslane_numer"></span>',
    '<span class="numer-duzy" id="wyslane-numer"></span>',
    '<span data-tekst="wyslane_numer_pomoc"></span>',
    "</div>",
    '<p id="wyslane-potwierdzenie"></p>',
    '<p class="uwaga" id="wyslane-brak"></p>',
    '<p data-tekst="wyslane_pytanie"></p>',
    '<a class="przycisk przycisk-drugi" href="/" target="_blank" rel="noopener noreferrer" data-tekst="wyslane_strona"></a>',
    "</div>",
  ]));
  const wyslane = funkcja("pokazWyslane");
  assert.match(wyslane, /wyslanePotwierdzenie \? "wyslane_potwierdzenie" : "wyslane_bez_potwierdzenia"/);
  // Powrót z ekranu po wysłaniu do kroku 6 z wpisanym adresem (pole nie jest czyszczone).
  assert.match(funkcja("wstawTeksty"), /t\("wyslane_brak_odnosnik"\)/);
  assert.match(funkcja("wrocDoWysylki"), /widok6 = "wysylka";/);
  assert.doesNotMatch(MAIN, /\$\("#p-adres"\)\.value = /, "adres nie jest czyszczony ani podmieniany");
});

test("droga z zapisem: krok 1 zapis z potwierdzeniem i zapis_gdzie, krok 2 wiadomość nieaktywna przed zapisem", () => {
  assert.match(HTML, ciag([
    '<div class="krok-drogi">',
    '<h3 data-tekst="droga_zapis_krok1"></h3>',
    '<button type="button" class="przycisk" id="zapisz" data-tekst="zapisz_przycisk"></button>',
    '<p class="potwierdzenie" id="zapis-gotowe" aria-live="polite" hidden></p>',
    '<p class="uwaga" id="zapis-ponownie" data-tekst="zapis_ponownie" hidden></p>',
    '<p class="podpowiedz" data-tekst="zapis_gdzie"></p>',
    "</div>",
    '<div class="krok-drogi">',
    '<h3 data-tekst="droga_zapis_krok2"></h3>',
    '<p id="po-zapisie" aria-live="polite" hidden></p>',
    '<p class="uwaga" id="mailto-bez-zalacznika"></p>',
    '<a class="przycisk przycisk-drugi" id="mailto" data-tekst="mailto_przycisk" aria-disabled="true" aria-describedby="mailto-najpierw-zapisz"></a>',
    '<p class="podpowiedz" id="mailto-najpierw-zapisz" data-tekst="mailto_najpierw_zapisz"></p>',
    "</div>",
    "</div>",
    '<button type="button" class="przycisk-tekstowy" id="zapasowa-wroc" data-tekst="zapasowa_wroc"></button>',
    "</div>",
  ]));
  // mailto_bez_zalacznika z nazwą pliku z numeru zgłoszenia, wstawione raz na starcie.
  assert.match(funkcja("wstawTeksty"), /\$\("#mailto-bez-zalacznika"\)\.textContent = t\("mailto_bez_zalacznika", \{ plik: nazwaZip\(NUMER\) \}\)/);
});

test("wiadomość w kroku 2: href dopiero po zapisie, zmiana pola znów ją wyłącza", () => {
  const wiad = funkcja("ustawWiadomosc");
  for (const r of [
    /m\.setAttribute\("href", mailto\)/, /m\.removeAttribute\("href"\)/,
    /m\.removeAttribute\("aria-disabled"\)/, /m\.setAttribute\("aria-disabled", "true"\)/,
    /m\.removeAttribute\("aria-describedby"\)/, /m\.setAttribute\("aria-describedby", "mailto-najpierw-zapisz"\)/,
    /pokaz\(\$\("#mailto-najpierw-zapisz"\), !mailto\)/,
  ]) assert.match(wiad, r);
  const schowaj = funkcja("schowajPotwierdzenieZapisu");
  assert.match(schowaj, /ustawWiadomosc\(null\)/);
  assert.match(schowaj, /pokaz\(\$\("#po-zapisie"\), false\)/);
  assert.match(funkcja("przelicz"), /schowajPotwierdzenieZapisu\(\);/);
  assert.match(funkcja("zapisz"), /ustawWiadomosc\(mailto\)/);
  assert.match(funkcja("pokazBladLogiki"), /schowajPotwierdzenieZapisu\(\)/);
  // Wygląd nieaktywnego przycisku także dla odnośnika z aria-disabled.
  assert.match(CSS, /\.przycisk:disabled, \.przycisk\[aria-disabled="true"\]/);
});

test("po zapisie: adres w po_zapisie to odnośnik z tym samym mailto: co „Napisz nową wiadomość”", () => {
  const zapis = funkcja("zapisz");
  assert.match(zapis, /const mailto = odnosnikMailto\(/);
  assert.match(zapis, /el\("a", \{ href: mailto, tekst: ADRES \}\)/);
  assert.match(zapis, /\$\("#po-zapisie"\)\.replaceChildren\(/);
  assert.equal((MAIN.match(/\bodnosnikMailto\(/g) ?? []).length, 1, "mailto liczony w jednym miejscu");
});

test("zapis: plik z gotowego ZIP-a, potem potwierdzenie i wiadomość; bez gotowego ZIP-a nic się nie dzieje", () => {
  const zapis = funkcja("zapisz");
  assert.match(zapis, /if \(czekaPrzeliczenie\) przelicz\(\);\n\s*const gotowy = aktualnyZip\(\);\n\s*if \(!gotowy\) return;/);
  assert.match(zapis, /el\("a", \{ href: adres, download: gotowy\.wynik\.nazwaZip \}\)/);
  const klik = zapis.indexOf("a.click();");
  assert.ok(klik > 0 && klik < zapis.indexOf("pokaz($(\"#zapis-gotowe\"), true);"), "potwierdzenie po zapisie");
  assert.ok(klik < zapis.indexOf("ustawWiadomosc(mailto);"), "wiadomość po zapisie");
});

test("potwierdzenie zapisu: zapis_gotowe po każdym zapisie, zapis_ponownie po zapisie innej treści", () => {
  const zapis = funkcja("zapisz");
  assert.match(zapis, /t\("zapis_gotowe", \{ plik: wynik\.nazwaZip \}\)/);
  assert.match(zapis, /rowneBajty\(poprzedniZapis, gotowy\.bajty\)/);
  assert.match(zapis, /pokaz\(\$\("#zapis-ponownie"\), zapisanoRozne\)/);
  // Zmiana pola chowa potwierdzenie razem z komunikatem po zapisie.
  const schowaj = funkcja("schowajPotwierdzenieZapisu");
  assert.match(schowaj, /pokaz\(\$\("#zapis-gotowe"\), false\)/);
  assert.match(schowaj, /pokaz\(\$\("#zapis-ponownie"\), false\)/);
});

test("nieaktualne potwierdzenie zapisu: zmiana pola chowa je od razu, zapis niemożliwy też", () => {
  // Kliknięcie zapisu w ciągu 250 ms po wpisaniu błędnej wartości nie może zostawić potwierdzenia
  // i aktywnej wiadomości do starego pliku.
  assert.match(funkcja("przeliczPozniej"), /schowajPotwierdzenieZapisu\(\);\n\s*odlozone = setTimeout\(przelicz, 250\);/);
  const przel = funkcja("przelicz");
  const schowanie = przel.indexOf("schowajPotwierdzenieZapisu();");
  assert.ok(schowanie > 0 && schowanie < przel.indexOf("zlozZgloszenie("), "każde przeliczenie, przed złożeniem zgłoszenia");
  assert.doesNotMatch(przel, /poZapisie/, "zapis nie przelicza zgłoszenia");
  assert.equal((MAIN.match(/\bschowajPotwierdzenieZapisu\(\)/g) ?? []).length, 4, "definicja i trzy wywołania");
});

test("bez kopiowania adresu, schowka i udostępniania przez okno systemowe", () => {
  for (const [nazwa, tresc] of [["main.js", MAIN], ["index.html", HTML], ["style.css", CSS]]) {
    assert.doesNotMatch(tresc, /kopiuj/i, nazwa);
    assert.doesNotMatch(tresc, /udostepn|droga-zapis-pokaz|canShare|clipboard/i, `${nazwa}: droga z udostępnianiem znika`);
  }
});

test("dodatkowe dane: przy rozbudowie instalacji miesiąc z własnym podpisem i pole mocy przed rozbudową z podpowiedzią", () => {
  const zmiany = funkcja("zbudujZmiany");
  assert.match(zmiany, /rodzaj === "rozbudowa_pv"/);
  assert.match(zmiany, /t\("instalacja_rozbudowa_od"\)/);
  assert.match(zmiany, /t\("instalacja_moc_przed"\)/);
  assert.match(zmiany, /t\("instalacja_moc_przed_pomoc"\)/);
  assert.match(zmiany, /"data-pole": "moc_przed_kwp"/);
  assert.match(zmiany, /inputmode: "decimal"/);
  // Do modułu formularza trafia moc przed tylko z wiersza rozbudowy.
  assert.match(funkcja("zbierzFormularz"), /moc_przed_kwp: wartoscPola\("moc_przed_kwp"\)/);
  // Błąd wiersza zmiany w jego własnym komunikacie, nie w komunikacie pola mocy przed.
  assert.match(funkcja("kontenerBledu"), /\$\(":scope > \.blad", wiersz\)/);
});

test("zdanie pod pytaniem o grupę taryfową zależne od rodzaju ceny, bez rodzaju bez zdania", () => {
  assert.match(blokPola("taryfa"), /<div class="opcje"><\/div>\s*<p class="podpowiedz" data-tekst="taryfa_przy_stalej" data-warunek="rodzaj_ceny=stala" hidden><\/p>\s*<p class="podpowiedz" data-tekst="taryfa_przy_dynamicznej" data-warunek="rodzaj_ceny=dynamiczna" hidden><\/p>\s*<p class="blad" hidden><\/p>/);
});

test("sprzedawca z listy wpisany jako „inny”: uwaga pod polem, bez blokady", () => {
  assert.match(blokPola("sprzedawca_nazwa"), /<p class="podpowiedz" data-tekst="tekst_wolny_podpowiedz"><\/p>\s*<p class="uwaga" id="sprzedawca-na-liscie" data-tekst="sprzedawca_na_liscie" hidden><\/p>\s*<p class="blad" hidden><\/p>/);
  assert.match(funkcja("pokazPola"), /pokaz\(\$\("#sprzedawca-na-liscie"\), wybrane\("sprzedawca"\) === "inny" && sprzedawcaZListy\(wartoscPola\("sprzedawca_nazwa"\)\)\);/);
});

test("zmiana pola: Pstryk ustawia cenę dynamiczną, „inny okres” wpisuje daty z miesiąca, cena po wyjściu z pola uzupełniona", () => {
  const zmiana = funkcja("zmianaPola");
  assert.match(zmiana, /if \(pole\.name === "sprzedawca" && pole\.value === "pstryk"\) \$\('input\[name="rodzaj_ceny"\]\[value="dynamiczna"\]'\)\.checked = true;/);
  assert.match(zmiana, /\["taryfa", "cena_tryb", "rodzaj_ceny", "sprzedawca"\]\.includes\(pole\.name\)\) zbudujPolaCen\(\);/, "pola ceny po zmianie rodzaju");
  assert.ok(zmiana.indexOf('"pstryk"') < zmiana.indexOf("zbudujPolaCen()"), "rodzaj ceny ustawiony przed przebudową pól");
  assert.doesNotMatch(zmiana, /checked = false|\.value = ""/, "zmiana sprzedawcy niczego nie kasuje");
  assert.match(zmiana, /if \(pole\.id === "p-okres-inny" && pole\.checked\) wpiszDatyZMiesiaca\(\);/);
  assert.match(zmiana, /if \(pole\.matches\("#p-cena, \[data-strefa\]"\)\) uzupelnijCene\(pole\);/);
  assert.match(MAIN, /main\.addEventListener\("change", zmianaPola\);/);
  // Daty tylko przy wybranym miesiącu i obu pustych polach; wpisanych dat nie nadpisuje.
  const daty = funkcja("wpiszDatyZMiesiaca");
  assert.match(daty, /okresMiesiaca\(wartoscMiesiacaFaktury\(\)\)/);
  assert.match(daty, /if \(!okres \|\| od\.value \|\| doDnia\.value\) return;/);
  // Postać z modułu, kropka zamieniona na przecinek; błędna wartość zostaje.
  assert.match(funkcja("uzupelnijCene"), /const c = czytajCene\(pole\.value\);\n\s*if \(c\.ok\) pole\.value = c\.wartosc\.replace\("\.", ","\);/);
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

test("zapis: pytanie przed opuszczeniem strony zdjęte przed kliknięciem odnośnika z plikiem", () => {
  const zapis = funkcja("zapisz");
  const klik = zapis.indexOf("a.click();");
  const oddane = zapis.indexOf("oddane = true;");
  const ostrzezenie = zapis.indexOf("ustawOstrzezenie();");
  assert.ok(oddane > 0 && oddane < ostrzezenie && ostrzezenie < klik, "oddane i ustawOstrzezenie przed a.click()");
  assert.equal((zapis.match(/ustawOstrzezenie\(\);/g) ?? []).length, 1);
});

test("nieudana budowa ZIP-a: krok 6 pokazuje zip_blad, kolejne wejście na krok ponawia próbę", () => {
  const budowa = funkcja("zbudujZip");
  // Odrzucona obietnica: koniec budowy dla tego zgłoszenia i zapamiętany błąd, jeśli dane się nie
  // zmieniły; potem odświeżenie kroku 6.
  const odrzucenie = budowa.slice(budowa.indexOf("}, (blad) => {"));
  assert.ok(odrzucenie.length > 20, "obsługa odrzuconej obietnicy");
  assert.match(odrzucenie, /budowanyDla = null;/);
  assert.match(odrzucenie, /bladZipu = budowany;/);
  assert.match(odrzucenie, /pokazWysylke\(\);/);
  // Nowa próba czyści błąd; zmiana danych też.
  assert.match(budowa, /budowanyDla = budowany;\n\s*bladZipu = null;/);
  assert.match(funkcja("uniewaznijZip"), /bladZipu = null;/);
  // Wejście na krok 5 albo 6 woła zbudujZip, a ten nie zaczyna od nowa tylko wtedy, gdy ZIP jest
  // gotowy albo w budowie.
  assert.match(budowa, /if \(!wynik\?\.moznaZapisac \|\| zip\?\.wynik === wynik \|\| budowanyDla === wynik\) return;/);
  // zip_blad zamiast blad_nieznany, który mówi o odczycie pliku z eLicznika.
  assert.match(funkcja("pokazWysylke"), /else if \(bladZipu === wynik\) tresc = t\("zip_blad"\);/);
  assert.doesNotMatch(funkcja("pokazWysylke"), /blad_nieznany/);
});

test("ekran po wysłaniu: napis kreator_gotowe zamiast numeru kroku; powrót do wysyłki przywraca numer", () => {
  assert.match(funkcja("pokazWyslane"), /\$\("#kreator-krok"\)\.textContent = t\("kreator_gotowe"\);/);
  assert.match(funkcja("wrocDoWysylki"), /\$\("#kreator-krok"\)\.textContent = t\("kreator_krok", \{ n: KROKI, m: KROKI \}\);/);
  // Nagłówek kroku dostaje fokus po przejściu; ekran po wysłaniu ma własny fokus (pokazWyslane).
  assert.doesNotMatch(MAIN, /function naglowekKroku/);
  assert.match(funkcja("pokazKrok"), /\$\("h1", sekcjaKroku\(n\)\)\.focus\(\{ preventScroll: true \}\);/);
});

test("fokus przy błędzie całego pola ceny: pole ceny, nie przełącznik jednej ceny i cen w strefach", () => {
  // Przy taryfie „inna” przełącznik (#cena-tryb) stoi w polu ceny przed polami cen, więc
  // „pierwsze widoczne pole w kontenerze” trafiałoby w przełącznik. Błąd całego pola (format
  // jednej ceny, liczba stref) daje fokus pierwszemu pustemu polu ceny, a gdy pustego nie ma,
  // pierwszemu polu ceny. Błąd ceny w konkretnej strefie wskazuje to pole (#p-cena-N).
  assert.ok(HTML.indexOf('id="cena-tryb"') < HTML.indexOf('id="cena-pola"'), "przełącznik przed polami cen");
  const f = funkcja("poleDoFokusu");
  assert.match(f, /\n  if \(pole === "cena_energii_netto_zl_kwh"\) \{\n    const ceny = \$\$\("#cena-pola input"\)\.filter\(widoczne\);\n    const cena = ceny\.find\(\(e\) => !e\.value\.trim\(\)\) \?\? ceny\[0\];\n    if \(cena\) return cena;\n  \}\n/);
  assert.match(f, /const strefa = \/\^cena_energii_netto_zl_kwh\\\[\(\\d\+\)\\\]\$\/\.exec\(pole\);/);
  assert.ok(f.indexOf('pole === "cena_energii_netto_zl_kwh"') < f.indexOf('$$("input, select", kontener)'), "przed ogólnym wyborem pola");
});

test("nazwy pól w komunikatach z pola_nazwy, bez nazw zastępczych", () => {
  assert.doesNotMatch(MAIN, /NAZWY_ZASTEPCZE/);
  assert.match(funkcja("nazwyPol"), /TEKSTY\.pola_nazwy\[p\] \?\? p/);
});

test("blokada z pól wpisanych ręcznie zatrzymuje „Dalej” w kroku z polem, które ją wywołało", () => {
  const blad = funkcja("bladKroku");
  // Pola wskazane przez moduł zgłoszenia, w tym kroku, w kolejności na stronie; tekst blokady
  // w komunikacie kroku, fokus na pierwszym polu (błędnym albo z blokadą).
  assert.match(blad, /const blokada = wKroku\(n, \(wynik\?\.polaBezpiecznika \?\? \[\]\)\.map\(\(pole\) => \(\{ pole \}\)\)\);/);
  assert.match(blad, /if \(blokada\.length > 0\) teksty\.push\(t\(BLOKADA_POL\)\);/);
  assert.match(blad, /fokus: poleDoFokusu\(wKolejnosci\(\[\.\.\.bledne, \.\.\.blokada\]\)\[0\]\)/);
  // Pole, którego nie ma w żadnym kroku, nie zatrzymuje: blokada zostaje w kroku 6.
  assert.match(funkcja("pokazWysylke"), /wynik\.blokady\.some\(\(b\) => b\.kod === BLOKADA_POL\)\) tresc = t\(BLOKADA_POL\);/);
});

test("odliczanie pod przyciskiem wysyłki: liczenie w wysylka.js, linia odświeżana co sekundę, znika z odpowiedzią albo błędem", () => {
  assert.match(KOD, /import \{[^}]*\bsekundyCzekania\b[^}]*\} from "\.\/lib\/wysylka\.js"/);
  const wysylka = funkcja("wyslij");
  // Odliczanie startuje razem z żądaniem i co sekundę pyta moduł o liczbę sekund (null: bez linii).
  assert.match(wysylka, /const poczatek = performance\.now\(\);/);
  assert.match(wysylka, /const odliczanie = setInterval\(\(\) => pokazCzekanie\(sekundyCzekania\(performance\.now\(\) - poczatek\)\), 1000\);/);
  assert.ok(wysylka.indexOf("setInterval(") < wysylka.indexOf("fetch("), "odliczanie przed żądaniem");
  // Koniec czekania (odpowiedź, błąd sieci, przekroczony czas): odliczanie zatrzymane, linia
  // schowana.
  const koniec = wysylka.slice(wysylka.indexOf("} finally {"));
  assert.match(koniec, /clearInterval\(odliczanie\);/);
  assert.match(koniec, /pokazCzekanie\(null\);/);
  const czekanie = funkcja("pokazCzekanie");
  assert.match(czekanie, /t\("wysylka_czekanie", \{ sekundy \}\)/);
  assert.match(czekanie, /pokaz\(e, sekundy !== null\);/);
  assert.equal((KOD.match(/\bsetInterval\(/g) ?? []).length, 1, "jedno odliczanie w kodzie strony");
});

test("komunikat po nieudanej wysyłce znika przy zmianie adresu i przy wyborze „Wyślij zgłoszenie”, także z błędnym adresem", () => {
  // Zmiana adresu: tekst przy polu i komunikat poprzedniej próby znikają razem.
  assert.match(KOD, /\$\("#p-adres"\)\.addEventListener\("input", \(\) => \{\n\s*pokazBladAdresu\(false\);\n\s*schowajBladWysylki\(\);\n\s*\}\);/);
  const schowaj = funkcja("schowajBladWysylki");
  assert.match(schowaj, /bladWysylki = null;/);
  assert.match(schowaj, /pokazWysylke\(\);/);
  // Przycisk: komunikat poprzedniej próby znika, zanim narzędzie sprawdzi adres, więc przy błędnym
  // adresie zostaje sam tekst przy polu.
  const wysylka = funkcja("wyslij");
  const czyszczenie = wysylka.indexOf("schowajBladWysylki();");
  assert.ok(czyszczenie > 0 && czyszczenie < wysylka.indexOf("sprawdzAdres("), "przed sprawdzeniem adresu");
  assert.ok(wysylka.indexOf("wysylkaDostepna(") < czyszczenie, "po sprawdzeniu, czy wysyłka jest dostępna");
});

test("liczba wpisana od przecinka: po wyjściu z pola zero na początku we wszystkich polach z liczbą", () => {
  assert.match(KOD, /import \{[^}]*\bzeroPrzedPrzecinkiem\b[^}]*\} from "\.\/lib\/kwoty\.js"/);
  const zmiana = funkcja("zmianaPola");
  assert.match(zmiana, /if \(pole\.matches\('input\[inputmode="decimal"\]'\)\) uzupelnijZero\(pole\);/);
  // Zero przed uzupełnieniem ceny: „,3” w polu ceny staje się „0,3”, a potem „0,30”.
  assert.ok(zmiana.indexOf("uzupelnijZero(pole)") < zmiana.indexOf("uzupelnijCene(pole)"));
  assert.match(funkcja("uzupelnijZero"), /const z = zeroPrzedPrzecinkiem\(pole\.value\);\n\s*if \(z !== pole\.value\) pole\.value = z;/);
  // Każde pole na liczbę z przecinkiem ma inputmode="decimal": w index.html i w polach budowanych
  // w kodzie (ceny, kwota opłaty, moc przed rozbudową).
  for (const id of ["p-oplata_mocowa_zl_mies", "p-oplata_abonamentowa_zl_mies", "p-oplata_stala_sieciowa_zl_mies", "p-oplata_przejsciowa_zl_mies", "p-moc_pv_kwp", "p-magazyn_pojemnosc_kwh"]) {
    assert.match(HTML, new RegExp(`<input type="text" id="${id}" inputmode="decimal"`), id);
  }
  assert.equal((MAIN.match(/inputmode: "decimal"/g) ?? []).length, 4, "strefa, jedna cena, kwota opłaty, moc przed rozbudową");
});

test("kolejność cen w strefach: uwaga pod polami cen z nazwami stref, bez blokady", () => {
  assert.match(blokPola("cena_energii_netto_zl_kwh"), /<p class="uwaga" id="faktura-cena-nietypowa" data-tekst="faktura_cena_nietypowa" hidden><\/p>\s*<p class="uwaga" id="faktura-ceny-kolejnosc" hidden><\/p>\s*<p class="blad" hidden><\/p>/);
  const pola = funkcja("pokazPola");
  assert.match(pola, /const kolejnosc = wynik\.uwagi\.some\(\(u\) => u\.kod === "FAKTURA_CENY_KOLEJNOSC"\) && STREFY_KOLEJNOSC\[wybrane\("taryfa"\)\];/);
  assert.match(pola, /t\("faktura_ceny_kolejnosc", \{ najdrozsza: nazwy\[kolejnosc\.najdrozsza\], najtansza: nazwy\[kolejnosc\.najtansza\] \}\)/);
  assert.match(pola, /const nazwy = nazwyStref\(wybrane\("taryfa"\)\);/);
  assert.match(KOD, /import \{[^}]*\bSTREFY_KOLEJNOSC\b[^}]*\} from "\.\/lib\/formularz\.js"/);
  // Uwaga nie zatrzymuje „Dalej”: bladKroku patrzy tylko na błędy pól i blokadę.
  assert.doesNotMatch(funkcja("bladKroku"), /KOLEJNOSC|uwagi/);
});
