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

// Fragment index.html od elementu z data-pole="nazwa" do następnego pola albo końca sekcji.
function blokPola(nazwa) {
  const i = HTML.indexOf(`data-pole="${nazwa}"`);
  assert.ok(i > 0, nazwa);
  const reszta = HTML.slice(i + 1);
  const koniec = reszta.search(/data-pole="|<\/section>/);
  return reszta.slice(0, koniec);
}

test("sekcja faktury: wstęp, potem pola w kolejności z formularza", () => {
  const sekcja = /<section class="krok" id="krok-faktura">([\s\S]*?)<\/section>/.exec(HTML)[1];
  assert.ok(sekcja.indexOf('data-tekst="faktura_wstep"') < sekcja.indexOf("data-pole="), "wstęp przed polami");
  const pola = [...sekcja.matchAll(/data-pole="([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(pola, [
    "system_rozliczenia", "sprzedawca", "sprzedawca_nazwa", "taryfa", "taryfa_nazwa", "okres_od", "okres_do", "rodzaj_faktury",
    "rodzaj_ceny", "cena_energii_netto_zl_kwh", "oplata_mocowa_zl_mies", "oplata_abonamentowa_zl_mies",
    "oplata_stala_sieciowa_zl_mies", "oplata_przejsciowa_zl_mies", "oplaty_stale_inne",
  ]);
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
  // Okres ma dwie etykiety (od, do), więc podpowiedź stoi tuż pod parą pól.
  assert.match(HTML, /<\/div>\s*<details class="pomoc">\s*<summary data-tekst="co_to_znaczy"><\/summary>\s*<p data-tekst="pomoc_okres"><\/p>/);
  assert.equal((HTML.match(/<details class="pomoc">/g) ?? []).length, 5);
  assert.doesNotMatch(HTML, /<details[^>]*\bopen\b/, "domyślnie zwinięte");
});

test("numery przy polach jak na rysunku, ukryte przed czytnikiem ekranu", () => {
  const NUMERY = {
    rodzaj_faktury: 1, okres_od: 2, okres_do: 2, sprzedawca: 3, taryfa: 4, system_rozliczenia: 5, cena_energii_netto_zl_kwh: 6,
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

test("zakres przed dodaniem pliku: zakres_pusty", () => {
  assert.match(MAIN, /t\("zakres_pusty"\)/);
});

// Ciało funkcji o danej nazwie z main.js (do następnej funkcji na poziomie modułu).
function funkcja(nazwa) {
  const m = new RegExp(`\\n(?:async )?function ${nazwa}\\([^)]*\\) \\{\\n([\\s\\S]*?)\\n\\}\\n`).exec(MAIN);
  assert.ok(m, nazwa);
  return m[1];
}

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

test("krok 1: odnośnik „jak go pobrać z eLicznika” do /elicznik/ w nowej karcie", () => {
  assert.match(HTML, /<p data-tekst="pliki_wybor"><\/p>\s*<p id="plik-instrukcja"><\/p>/);
  assert.match(MAIN, /el\("a", \{ href: "\/elicznik\/", target: "_blank", rel: "noopener noreferrer"/);
});

test("zapis: zapis_gdzie stale pod przyciskiem, zgoda_bez stale pod polem zgody", () => {
  assert.match(HTML, /id="zapisz" data-tekst="zapisz_przycisk"><\/button>\s*<p class="podpowiedz" data-tekst="zapis_gdzie"><\/p>/);
  assert.match(HTML, /<span id="zgoda-wiecej"><\/span>\s*<\/div>\s*<p class="podpowiedz" data-tekst="zgoda_bez"><\/p>/);
});

test("po zapisie: mailto_bez_zalacznika tuż nad przyciskiem wiadomości", () => {
  assert.match(HTML, /<p class="uwaga" id="mailto-bez-zalacznika"><\/p>\s*<a class="przycisk przycisk-drugi" id="mailto"/);
  assert.match(funkcja("zapisz"), /t\("mailto_bez_zalacznika", \{ plik: wynik\.nazwaZip \}\)/);
});

test("wysyłka: przycisk tylko, gdy canShare przyjmuje plik; share z plikiem i tytułem; AbortError to nie błąd", () => {
  assert.match(HTML, /<div id="udostepnij" hidden>\s*<button type="button" class="przycisk" id="udostepnij-przycisk" data-tekst="udostepnij_przycisk"><\/button>\s*<p class="podpowiedz" data-tekst="udostepnij_podpowiedz"><\/p>/);
  const zapis = funkcja("zapisz");
  assert.match(zapis, /new File\(\[zip\], wynik\.nazwaZip, \{ type: "application\/zip" \}\)/);
  assert.match(MAIN, /navigator\.canShare\(\{ files: \[plik\] \}\)/);
  const udostepnij = funkcja("udostepnij");
  assert.match(udostepnij, /navigator\.share\(\{ files: \[plik\], title: t\("udostepnij_tytul", \{ numer: NUMER \}\) \}\)/);
  assert.match(udostepnij, /AbortError/);
});
