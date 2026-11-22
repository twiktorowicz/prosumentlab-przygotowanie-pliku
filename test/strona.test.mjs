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
  assert.match(funkcja("udostepnij"), /navigator\.share/, "funkcja async");
  const repo = atrybutyOdnosnikow().find((a) => a.includes("ADRES_REPOZYTORIUM"));
  assert.match(repo, /rel: "noopener noreferrer"/, "atrybuty po wstawce ze zmienną");
  assert.doesNotMatch(KOD, /^\s*\/\//m, "bez linii komentarza");
  assert.match(KOD, /https:\/\/github\.com\//, "adres w tekście zostaje");
});

test("ZIP powstaje tylko przy zapisie albo wysyłce: utworzZipZgloszenia wołane w zapisz i udostepnij", () => {
  assert.equal((MAIN.match(/\butworzZipZgloszenia\s*\(/g) ?? []).length, 2);
  // Kompresja jest asynchroniczna: oba miejsca czekają na gotowy ZIP.
  assert.match(funkcja("zapisz"), /\bawait utworzZipZgloszenia\(zapisywany\)/);
  assert.match(funkcja("udostepnij"), /\bawait utworzZipZgloszenia\(udostepniany\)/);
  assert.doesNotMatch(funkcja("przelicz"), /\butworzZipZgloszenia\s*\(/);
  assert.doesNotMatch(MAIN, /wynik\.zip\b/);
  assert.doesNotMatch(MAIN, /plikDoWyslania/, "bez zapamiętanego ZIP-a do wysyłki");
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

test("nagłówek: napis ProsumentLab nad tytułem jako odnośnik do / w nowej karcie, akapit o operatorze pod opisem", () => {
  const naglowek = /<header class="naglowek">([\s\S]*?)<\/header>/.exec(HTML)[1];
  assert.match(naglowek, /<div class="tresc">\s*<a class="marka" href="\/" target="_blank" rel="noopener noreferrer" data-tekst="naglowek_marka"><\/a>\s*<h1 data-tekst="wstep_tytul"><\/h1>/);
  assert.match(naglowek, /<p class="wstep" data-tekst="wstep_opis"><\/p>\s*<p class="wstep" data-tekst="wstep_operator"><\/p>\s*<\/div>/);
  assert.equal((HTML.match(/href="\/"/g) ?? []).length, 1, "jeden odnośnik do strony głównej");
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

test("sekcja faktury: wstęp, potem pola w kolejności pytań: grupa „Faktura”, grupa „Cena energii”", () => {
  const sekcja = /<section class="krok" id="krok-faktura">([\s\S]*?)<\/section>/.exec(HTML)[1];
  assert.ok(sekcja.indexOf('data-tekst="faktura_wstep"') < sekcja.indexOf("data-pole="), "wstęp przed polami");
  const pola = [...sekcja.matchAll(/data-pole="([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(pola, [
    "system_rozliczenia", "sprzedawca", "sprzedawca_nazwa", "okres_miesiac", "okres_od", "okres_do", "rodzaj_faktury",
    "rodzaj_ceny", "taryfa", "taryfa_nazwa", "cena_energii_netto_zl_kwh", "oplata_mocowa_zl_mies", "oplata_abonamentowa_zl_mies",
    "oplata_stala_sieciowa_zl_mies", "oplata_przejsciowa_zl_mies", "oplaty_stale_inne",
  ]);
  // Nagłówek „Faktura” przed sposobem rozliczenia, poza polami chowanymi przy opustach; nagłówek
  // „Cena energii” w nich, tuż przed rodzajem ceny.
  assert.match(sekcja, /<\/figure>\s*<h3 data-tekst="faktura_grupa_faktura"><\/h3>\s*<fieldset class="pole" data-pole="system_rozliczenia"/);
  assert.match(sekcja, /<p class="blad" hidden><\/p>\s*<\/div>\s*<h3 data-tekst="faktura_grupa_cena"><\/h3>\s*<fieldset class="pole" data-pole="rodzaj_ceny"/);
  const pola_ = sekcja.indexOf('id="faktura-pola"');
  assert.ok(sekcja.indexOf("faktura_grupa_faktura") < pola_ && sekcja.indexOf("faktura_grupa_cena") > pola_);
  assert.equal((HTML.match(/<h3 data-tekst="faktura_grupa_/g) ?? []).length, 2);
  assert.doesNotMatch(HTML, /operator_dystrybucyjny|pierwsze_oddanie/, "bez pytań o operatora i pierwsze oddanie");
});

test("system opustów chowa wszystkie pola faktury poza systemem rozliczenia", () => {
  const m = /<div id="faktura-pola" data-warunek="system_rozliczenia!=opusty">([\s\S]*)<\/div>\s*<p class="uwaga" id="faktura-brak"/.exec(HTML);
  assert.ok(m, "kontener z warunkiem");
  assert.doesNotMatch(m[1], /data-pole="system_rozliczenia"/);
  assert.match(m[1], /data-pole="sprzedawca"/);
  assert.match(m[1], /data-pole="oplaty_stale_inne"/);
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
  assert.match(miesiac, /<legend><span class="nr" aria-hidden="true">2<\/span><span data-tekst="faktura_miesiac"><\/span><\/legend>\s*<div class="miesiac-rok" data-miesiac="okres_miesiac"><\/div>\s*<p class="blad" hidden><\/p>/);
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
  assert.match(zbierz, /okres_miesiac: innyOkres \? "" : wartoscMiesiaca\(\$\('\[data-miesiac="okres_miesiac"\]'\), \{ niepelny: true \}\)/);
  assert.match(zbierz, /okres_od: innyOkres \? wartoscPola\("okres_od"\) : ""/);
  assert.match(zbierz, /okres_do: innyOkres \? wartoscPola\("okres_do"\) : ""/);
  assert.doesNotMatch(war, /\.value\s*=/, "przełączanie nie czyści pól");
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

test("krok 7: tytuł, powód blokady, potem dwie drogi; droga z udostępnianiem schowana na starcie", () => {
  assert.match(HTML, ciag([
    '<section class="krok" id="krok-zapis">',
    '<h2 data-tekst="krok_zapis"></h2>',
    '<p class="uwaga" id="zapis-powod" aria-live="polite" hidden></p>',
    '<div class="droga" id="droga-udostepnianie" hidden>',
    '<button type="button" class="przycisk" id="udostepnij-przycisk" data-tekst="udostepnij_przycisk"></button>',
    '<p class="podpowiedz" data-tekst="udostepnij_podpowiedz"></p>',
    '<button type="button" class="przycisk-tekstowy" id="droga-zapis-pokaz" data-tekst="droga_zapis_pokaz"></button>',
    "</div>",
    '<div class="droga" id="droga-zapis">',
    '<p class="uwaga" id="udostepnij-niedostepne" data-tekst="udostepnij_niedostepne" hidden></p>',
  ]));
  assert.match(HTML, /<span id="zgoda-wiecej"><\/span>\s*<\/div>\s*<p class="podpowiedz" data-tekst="zgoda_bez"><\/p>/);
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
    "</section>",
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
  assert.match(funkcja("przelicz"), /if \(!poZapisie\) schowajPotwierdzenieZapisu\(\);/);
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

test("zapis czeka na skompresowany ZIP; dane zmienione w tym czasie: plik zapisany, bez potwierdzenia i wiadomości", () => {
  const zapis = funkcja("zapisz");
  assert.match(MAIN, /\nasync function zapisz\(\) \{/);
  assert.match(zapis, /const zapisywany = wynik;\n\s*const zip = await utworzZipZgloszenia\(zapisywany\);/);
  assert.match(zapis, /el\("a", \{ href: adres, download: zapisywany\.nazwaZip \}\)/);
  const sprawdzenie = zapis.indexOf("if (wynik !== zapisywany || czekaPrzeliczenie) return;");
  assert.ok(sprawdzenie > zapis.indexOf("a.click();"), "plik zapisany przed sprawdzeniem");
  assert.ok(sprawdzenie > zapis.indexOf("poprzedniZapis = zip;"), "zapisany plik zapamiętany do porównania");
  assert.ok(sprawdzenie < zapis.indexOf("pokaz($(\"#zapis-gotowe\"), true);"), "potwierdzenie dopiero po sprawdzeniu");
  assert.ok(sprawdzenie < zapis.indexOf("ustawWiadomosc(mailto);"), "wiadomość dopiero po sprawdzeniu");
});

test("potwierdzenie zapisu: zapis_gotowe po każdym zapisie, zapis_ponownie po zapisie innej treści", () => {
  const zapis = funkcja("zapisz");
  assert.match(zapis, /t\("zapis_gotowe", \{ plik: wynik\.nazwaZip \}\)/);
  assert.match(zapis, /rowneBajty\(poprzedniZapis, zip\)/);
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
  const poZlozeniu = przel.indexOf("pokazZapis();");
  const zawsze = przel.indexOf("if (!wynik?.moznaZapisac) schowajPotwierdzenieZapisu();");
  assert.ok(poZlozeniu > 0 && zawsze > poZlozeniu, "po złożeniu zgłoszenia, także przy zapisie");
  assert.doesNotMatch(przel.slice(zawsze - 40, zawsze), /poZapisie/, "bez warunku poZapisie");
  assert.equal((MAIN.match(/\bschowajPotwierdzenieZapisu\(\)/g) ?? []).length, 5, "definicja i cztery wywołania");
});

test("wybór drogi: udostępnianie tylko przy obsłudze plików i ekranie dotykowym, do odmowy albo wyboru zapisu", () => {
  const zapisPokaz = funkcja("pokazZapis");
  assert.match(zapisPokaz, /const drogaUdostepniania = mozeUdostepnic\(PLIK_PROBNY\) && matchMedia\("\(pointer: coarse\)"\)\.matches && !udostepnianieOdrzucone && !drogaZapisWybrana;/);
  assert.match(zapisPokaz, /pokaz\(\$\("#droga-udostepnianie"\), drogaUdostepniania\)/);
  assert.match(zapisPokaz, /pokaz\(\$\("#droga-zapis"\), !drogaUdostepniania\)/);
  // Przycisk udostępniania jest nieaktywny tak jak zapis, zamiast znikać razem z drogą.
  assert.match(zapisPokaz, /\$\("#udostepnij-przycisk"\)\.disabled = !wynik\.moznaZapisac;/);
  assert.match(zapisPokaz, /pokaz\(\$\("#udostepnij-niedostepne"\), udostepnianieOdrzucone\)/);
  assert.match(MAIN, /navigator\.canShare\(\{ files: \[plik\] \}\)/);
  assert.match(MAIN, /\nlet drogaZapisWybrana = false;/);
  assert.equal((MAIN.match(/drogaZapisWybrana = /g) ?? []).length, 2, "ustawiane tylko na starcie i przy wyborze zapisu");
  const wybor = funkcja("pokazDrogeZapisu");
  assert.match(wybor, /drogaZapisWybrana = true;/);
  assert.match(wybor, /przejdzDoZapisu\(\);/);
  // Przejście chowa drogę z udostępnianiem i przenosi fokus na zapis (znika przycisk z fokusem).
  const przejscie = funkcja("przejdzDoZapisu");
  assert.match(przejscie, /pokaz\(\$\("#droga-udostepnianie"\), false\)/);
  assert.match(przejscie, /pokaz\(\$\("#droga-zapis"\), true\)/);
  assert.match(przejscie, /pokaz\(\$\("#udostepnij-niedostepne"\), udostepnianieOdrzucone\)/);
  assert.match(przejscie, /\$\("#zapisz"\)\.focus\(\)/);
  assert.match(MAIN, /\$\("#droga-zapis-pokaz"\)\.addEventListener\("click", pokazDrogeZapisu\)/);
});

test("udostępnianie: adres do schowka bez czekania, zaraz potem share z plikiem, tytułem i tekstem", () => {
  const udostepnij = funkcja("udostepnij");
  assert.match(udostepnij, /const udostepniany = wynik;\n\s*const plik = new File\(\[await utworzZipZgloszenia\(udostepniany\)\], udostepniany\.nazwaZip, \{ type: "application\/zip" \}\)/);
  assert.match(udostepnij, /navigator\.share\(\{ files: \[plik\], title: t\("udostepnij_tytul", \{ numer: NUMER \}\), text: t\("udostepnij_tekst", \{ numer: NUMER \}\) \}\)/);
  // Schowek przed share(), bez await i z pominięciem błędu (także braku schowka).
  const schowek = udostepnij.indexOf("navigator.clipboard.writeText(ADRES)");
  assert.ok(schowek > 0 && schowek < udostepnij.indexOf("navigator.share("), "writeText przed share");
  assert.match(udostepnij, /try \{\n\s*navigator\.clipboard\.writeText\(ADRES\)\.catch\(\(\) => \{\}\);\n\s*\} catch \{/);
  assert.doesNotMatch(udostepnij, /await navigator\.clipboard/);
  // Okno udostępniania i schowek wymagają gestu użytkownika. Przed share() jest tylko jedno
  // await: na skompresowany ZIP (ułamek sekundy, w czasie aktywacji przez gest), a schowek idzie
  // jeszcze przed nim.
  assert.ok(udostepnij.includes("await navigator.share("));
  const przedShare = udostepnij.slice(0, udostepnij.indexOf("await navigator.share("));
  assert.deepEqual(przedShare.match(/\bawait\b[^;]*/g), ["await utworzZipZgloszenia(udostepniany)], udostepniany.nazwaZip, { type: \"application/zip\" })"]);
  assert.ok(schowek < udostepnij.indexOf("await utworzZipZgloszenia("), "writeText przed czekaniem na ZIP");
});

test("udostępnianie: odmowa inna niż AbortError przełącza do końca wizyty na drogę z zapisem z udostepnij_niedostepne", () => {
  const udostepnij = funkcja("udostepnij");
  assert.match(udostepnij, /blad\?\.name === "AbortError"/);
  assert.match(udostepnij, /udostepnianieOdrzucone = true;\n\s*przejdzDoZapisu\(\);/);
  assert.doesNotMatch(udostepnij, /console\./, "komunikat na stronie zamiast wpisu w konsoli");
  assert.match(MAIN, /\nlet udostepnianieOdrzucone = false;/);
  assert.equal((MAIN.match(/udostepnianieOdrzucone = /g) ?? []).length, 2, "ustawiane tylko na starcie i przy odmowie");
});

test("bez osobnego przycisku kopiowania adresu", () => {
  for (const [nazwa, tresc] of [["main.js", MAIN], ["index.html", HTML], ["style.css", CSS]]) {
    assert.doesNotMatch(tresc, /kopiuj/i, nazwa);
    assert.doesNotMatch(tresc, /przyciski-zapisu|id="udostepnij"|#udostepnij\b(?!-)/, `${nazwa}: stary układ kroku 7`);
  }
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
  assert.match(daty, /okresMiesiaca\(wartoscMiesiaca\(\$\('\[data-miesiac="okres_miesiac"\]'\)\)\)/);
  assert.match(daty, /if \(!okres \|\| od\.value \|\| doDnia\.value\) return;/);
  // Postać z modułu, kropka zamieniona na przecinek; błędna wartość zostaje.
  assert.match(funkcja("uzupelnijCene"), /const c = czytajCene\(pole\.value\);\n\s*if \(c\.ok\) pole\.value = c\.wartosc\.replace\("\.", ","\);/);
});
