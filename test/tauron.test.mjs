// Odczyt pliku z eLicznika Taurona: dekodowanie, rozpoznanie, sprawdzenia, usunięcie kolumn
// i bezpiecznik. Dane wyłącznie z generatora.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { dekoduj, LIMIT_BAJTOW } from "../app/lib/dekodowanie.js";
import { czytajTauron, LIMIT_WIERSZY } from "../app/lib/tauron.js";
import { sprawdzBezpiecznik } from "../app/lib/bezpiecznik.js";
import { generuj, PPE_FIKCYJNE, PLATNICY_FIKCYJNI } from "../narzedzia/generator.mjs";

const WZORZEC_N1 = readFileSync(fileURLToPath(new URL("wzorce/n1_wyjscie.csv", import.meta.url)));
const N1 = { od: "2025-06-06", do: "2025-06-07", taryfa: "G13", ziarno: 1 };
const DZIEN = { od: "2025-02-03", do: "2025-02-03", ziarno: 1 };

const utf8 = (t) => new TextEncoder().encode(t);

function czytaj(bajty) {
  const d = dekoduj(bajty);
  if (!d.ok) return d;
  const w = czytajTauron(d.tekst);
  return w.ok ? { ...w, kodowanie: d.kodowanie } : w;
}

// Numer linii (od 1) pierwszej linii pliku surowego, która zawiera `fragment` po `znacznik`.
function liniaZ(bajty, znacznik, seria) {
  const linie = new TextDecoder("windows-1250").decode(bajty).split("\r\n");
  return linie.findIndex((l) => l.includes(`;${seria};${znacznik};`)) + 1;
}

test("N1: plik surowy Windows-1250, CRLF, 2 doby G13 daje plik wzorcowy co do bajtu", () => {
  const w = czytaj(generuj(N1).surowy);
  assert.equal(w.ok, true);
  assert.equal(w.wariant, "surowy");
  assert.equal(w.kodowanie, "windows-1250");
  assert.deepEqual(Buffer.from(utf8(w.wynik)), WZORZEC_N1);
  assert.deepEqual(w.identyfikatory, { platnik: PLATNICY_FIKCYJNI[0], ppe: `PPE:${PPE_FIKCYJNE[0]}` });
  assert.deepEqual(w.usunieteKolumny, ["Nr platnika", "Nr punktu poboru energii"]);
  assert.equal(w.wierszeDanych, 96);
  assert.equal(w.pierwszyZnacznik, "2025-06-06 01:00");
  assert.equal(w.ostatniZnacznik, "2025-06-08 00:00");
  assert.deepEqual(w.uwagi, []);
});

test("N2: plik zanonimizowany UTF-8, LF wychodzi bez zmian i bez identyfikatorów", () => {
  const wejscie = generuj(N1).zanonimizowany;
  const w = czytaj(wejscie);
  assert.equal(w.ok, true);
  assert.equal(w.wariant, "zanonimizowany");
  assert.equal(w.kodowanie, "utf-8");
  assert.deepEqual(utf8(w.wynik), wejscie);
  assert.equal(w.identyfikatory, null);
  assert.deepEqual(w.usunieteKolumny, []);
});

test("N3: plik z BOM UTF-8 i plik surowy w UTF-8 dają ten sam wynik co N1", () => {
  const bom = czytaj(generuj({ ...N1, kodowanie: "utf-8-bom" }).surowy);
  const bezBom = czytaj(generuj({ ...N1, kodowanie: "utf-8" }).surowy);
  const lf = czytaj(generuj({ ...N1, kodowanie: "utf-8", koniecLinii: "\n" }).surowy);
  assert.equal(bom.kodowanie, "utf-8-bom");
  assert.equal(bezBom.kodowanie, "utf-8");
  for (const w of [bom, bezBom, lf]) assert.deepEqual(Buffer.from(utf8(w.wynik)), WZORZEC_N1);
  const anonimBom = new Uint8Array([0xef, 0xbb, 0xbf, ...generuj(N1).zanonimizowany]);
  assert.deepEqual(Buffer.from(utf8(czytaj(anonimBom).wynik)), WZORZEC_N1);
});

test("N4: BOM UTF-16 LE i BE odrzucony przed dekodowaniem", () => {
  for (const bom of [[0xff, 0xfe], [0xfe, 0xff]]) {
    assert.deepEqual(dekoduj(new Uint8Array([...bom, 0x52, 0x00, 0x6f, 0x00])), { ok: false, kod: "blad_kodowanie" });
  }
});

test("N32: pliki arkusza .xlsx i .xls (także .ods) dostają blad_arkusz", () => {
  const xlsx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
  const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.deepEqual(dekoduj(xlsx), { ok: false, kod: "blad_arkusz" });
  assert.deepEqual(dekoduj(xls), { ok: false, kod: "blad_arkusz" });
});

test("inny plik binarny: blad_nieznany; plik za duży: blad_za_duzy", () => {
  assert.deepEqual(dekoduj(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])), { ok: false, kod: "blad_nieznany" });
  assert.deepEqual(dekoduj(new Uint8Array(LIMIT_BAJTOW + 1)), { ok: false, kod: "blad_za_duzy" });
  assert.equal(LIMIT_BAJTOW, 10 * 1024 * 1024);
});

test("N33: nagłówek innego operatora i inny raport z eLicznika", () => {
  assert.deepEqual(czytaj(utf8("Data;Godzina;Zużycie [kWh]\n2025-01-01;01:00;0,5\n")), { ok: false, kod: "blad_inny_operator" });
  assert.deepEqual(czytaj(utf8("Data,Wartość\n2025-01-01,1\n")), { ok: false, kod: "blad_inny_operator" });
  assert.deepEqual(
    czytaj(utf8("Rodzaj energii;Data;Wartosc[kWh/kvar]\nenergia czynna pobrana netto;2025-01-01;1,000\n")),
    { ok: false, kod: "blad_naglowek" },
  );
});

test("pusty plik: zero bajtów albo same puste linie dają blad_nieznany", () => {
  assert.deepEqual(czytaj(new Uint8Array(0)), { ok: false, kod: "blad_nieznany" });
  assert.deepEqual(czytaj(utf8("\n\r\n   \n\t\n")), { ok: false, kod: "blad_nieznany" });
  assert.deepEqual(czytaj(new Uint8Array([0xef, 0xbb, 0xbf])), { ok: false, kod: "blad_nieznany" }, "sam znacznik BOM");
});

test("N5: drugi PPE w środku pliku to blokada blad_wiele_ppe", () => {
  assert.deepEqual(czytaj(generuj({ ...DZIEN, drugiPpe: true }).surowy), { ok: false, kod: "blad_wiele_ppe", blokada: true });
  const linie = new TextDecoder("windows-1250").decode(generuj(DZIEN).surowy).split("\r\n");
  const ostatni = linie.length - 2; // po ostatnim CRLF zostaje pusty element
  assert.match(linie[ostatni], /^10000001;/);
  linie[ostatni] = linie[ostatni].replace(/^10000001;/, `${PLATNICY_FIKCYJNI[1]};`);
  assert.deepEqual(czytaj(utf8(linie.join("\r\n"))), { ok: false, kod: "blad_wiele_ppe", blokada: true });
});

test("N7: PPE w kolumnie Strefa, słowo PPE, ciąg 12 cyfr, adres e-mail: każdy osobno blokuje z numerem wiersza", () => {
  const z = "2025-02-03 05:00";
  const przypadki = {
    "PPE w Strefa": { ppeWStrefie: { znacznik: z, seria: "pobor" } },
    "same cyfry PPE bez przedrostka w Strefa": { podmien: [{ znacznik: z, seria: "pobor", pole: "strefa", tekst: PPE_FIKCYJNE[0] }] },
    "słowo PPE": { podmien: [{ znacznik: z, seria: "pobor", pole: "strefa", tekst: "Reszta dnia PPE" }] },
    "słowo ppe małymi literami": { podmien: [{ znacznik: z, seria: "pobor", pole: "strefa", tekst: "nr ppe" }] },
    "ciąg 12 cyfr": { podmien: [{ znacznik: z, seria: "pobor", pole: "strefa", tekst: "7".repeat(12) }] },
    "adres e-mail": { podmien: [{ znacznik: z, seria: "pobor", pole: "strefa", tekst: ["jan", "przyklad.pl"].join("@") }] },
    "PPE GS1 ze spacjami": { podmien: [{ znacznik: z, seria: "pobor", pole: "strefa", tekst: ["590", "1234", "5678", "9012", "345"].join(" ") }] },
    "PPE GS1 z myślnikami": { podmien: [{ znacznik: z, seria: "pobor", pole: "strefa", tekst: ["590", "1234", "5678", "9012", "345"].join("-") }] },
  };
  for (const [nazwa, opcje] of Object.entries(przypadki)) {
    const bajty = generuj({ ...DZIEN, ...opcje }).surowy;
    const linia = liniaZ(bajty, z, "energia czynna pobrana netto");
    assert.ok(linia > 1);
    assert.deepEqual(czytaj(bajty), { ok: false, kod: "blad_bezpiecznik", wiersz: linia, blokada: true }, nazwa);
  }
});

test("reguła 6: numer zapisany z odstępami albo kropkami w innym polu blokuje", () => {
  const z = "2025-02-03 05:00";
  const wStrefie = (tekst) => generuj({ ...DZIEN, podmien: [{ znacznik: z, seria: "pobor", pole: "strefa", tekst }] }).surowy;
  const przypadki = {
    "numer płatnika z odstępami": PLATNICY_FIKCYJNI[0].match(/.{2}/g).join(" "),
    "PPE z kropkami co cztery cyfry": PPE_FIKCYJNE[0].match(/.{1,4}/g).join("."),
    "12 cyfr w grupach po cztery": ["7777", "7777", "7777"].join(" "),
    "numer płatnika z ukośnikami": PLATNICY_FIKCYJNI[0].match(/.{4}/g).join("/"),
  };
  for (const [nazwa, tekst] of Object.entries(przypadki)) {
    const bajty = wStrefie(tekst);
    const linia = liniaZ(bajty, z, "energia czynna pobrana netto");
    assert.deepEqual(czytaj(bajty), { ok: false, kod: "blad_bezpiecznik", wiersz: linia, blokada: true }, nazwa);
  }
});

test("reguła 6: zwykłe pliki z generatora nadal przechodzą", () => {
  for (const opcje of [
    { od: "2025-01-01", do: "2025-12-31", ziarno: 21 },
    { od: "2024-01-01", do: "2024-12-31", ziarno: 22, bierna: true },
    { od: "2025-01-01", do: "2025-03-31", ziarno: 23, ppe: PPE_FIKCYJNE[1], platnik: PLATNICY_FIKCYJNI[1] },
  ]) {
    assert.equal(czytaj(generuj(opcje).surowy).ok, true, JSON.stringify(opcje));
  }
});

test("same cyfry PPE w kolumnie wartości: plik odrzucony wcześniej, nie trafia do ZIP-a", () => {
  const bajty = generuj({ ...DZIEN, podmien: [{ znacznik: "2025-02-03 05:00", seria: "pobor", pole: "wartosc", tekst: PPE_FIKCYJNE[0] }] }).surowy;
  assert.equal(czytaj(bajty).kod, "blad_wartosc");
});

test("bezpiecznik: reguły osobno, w tym usunięte wartości od 6 znaków i granice słowa PPE", () => {
  const linie = (...t) => t.map((tekst, i) => ({ tekst, linia: i + 1 }));
  assert.equal(sprawdzBezpiecznik(linie("a;b", "c;d"), []), null);
  assert.deepEqual(sprawdzBezpiecznik(linie("a;b", "x;10000001;y"), ["10000001"]), { linia: 2 });
  assert.equal(sprawdzBezpiecznik(linie("a;12345;b"), ["12345"]), null, "wartość krótsza niż 6 znaków nie jest szukana");
  // Kolumna PPE ma postać "PPE:" i cyfry. Same cyfry bez przedrostka, które przeciekły do innej
  // kolumny, też są szukane, nawet gdy są za krótkie dla reguły 12 cyfr i wzorca GS1.
  assert.deepEqual(sprawdzBezpiecznik(linie("a;b", "x;87654321;y"), ["PPE:87654321"]), { linia: 2 });
  assert.deepEqual(sprawdzBezpiecznik(linie(`x;${PPE_FIKCYJNE[0]};y`), [`PPE:${PPE_FIKCYJNE[0]}`]), { linia: 1 });
  assert.deepEqual(sprawdzBezpiecznik(linie("strefa PPE;1"), []), { linia: 1 });
  assert.deepEqual(sprawdzBezpiecznik(linie("strefa (ppe);1"), []), { linia: 1 });
  assert.equal(sprawdzBezpiecznik(linie("PPEX;1", "PPEŁ;1", "APPE;1"), []), null);
  assert.deepEqual(sprawdzBezpiecznik(linie("1;2", `a;${"1".repeat(13)};b`), []), { linia: 2 });
  assert.equal(sprawdzBezpiecznik(linie(`a;${"1".repeat(11)};b`), []), null, "11 cyfr nie blokuje");
  assert.deepEqual(sprawdzBezpiecznik(linie(`x;${["a.b", "c.pl"].join("@")}`), []), { linia: 1 });
  assert.equal(sprawdzBezpiecznik(linie("x;a@b;c"), []), null);
});

test("bezpiecznik, reguła 6: cyfry w każdym polu poza znacznikiem", () => {
  const linie = (...t) => t.map((tekst, i) => ({ tekst, linia: i + 1 }));
  const opcje = { poleZnacznika: 1 };
  // Znacznik daje 12 cyfr i mógłby przypadkiem zawierać usunięty numer, więc jest pominięty.
  assert.equal(sprawdzBezpiecznik(linie("seria;2025-06-06 01:00;Reszta dnia;0,500;100,00"), ["06060100"], opcje), null);
  assert.deepEqual(
    sprawdzBezpiecznik(linie("seria;2025-06-06 01:00;06.06.01.00;0,500;100,00"), ["06060100"], opcje),
    { linia: 1 },
    "te same cyfry w polu strefy blokują",
  );
  assert.deepEqual(sprawdzBezpiecznik(linie("a;b", "s;2025-01-01 01:00;12-34-56;1,000;100,00"), ["PPE:123456"], opcje), { linia: 2 });
  assert.equal(sprawdzBezpiecznik(linie("s;2025-01-01 01:00;12-34-5;1,000;100,00"), ["PPE:123456"], opcje), null, "5 cyfr to za mało");
  assert.deepEqual(sprawdzBezpiecznik(linie("s;2025-01-01 01:00;1.2.3.4.5.6.7.8.9.0.1.2;1,000;100,00"), [], opcje), { linia: 1 });
  assert.equal(sprawdzBezpiecznik(linie("s;2025-01-01 01:00;1.2.3.4.5.6.7.8.9.0.1;1,000;100,00"), [], opcje), null);
});

test("wiersz z inną liczbą kolumn: blad_wiersz z numerem linii pliku", () => {
  const tekst = new TextDecoder().decode(generuj({ ...DZIEN, kodowanie: "utf-8", koniecLinii: "\n" }).surowy).split("\n");
  tekst[5] += ";nadmiar";
  assert.deepEqual(czytajTauron(tekst.join("\n")), { ok: false, kod: "blad_wiersz", wiersz: 6 });
});

test("puste linie są pomijane, a numer wiersza to numer linii w pliku", () => {
  const linie = new TextDecoder().decode(generuj({ ...DZIEN, kodowanie: "utf-8", koniecLinii: "\n" }).surowy).split("\n");
  linie.splice(3, 0, "", "  ");
  const w = czytajTauron(linie.join("\n"));
  assert.equal(w.ok, true);
  assert.equal(w.wierszeDanych, 48);
  linie[10] = linie[10].replace(/;\d+,\d{3};/, ";1.5;");
  assert.deepEqual(czytajTauron(linie.join("\n")), { ok: false, kod: "blad_wartosc", wiersz: 11 });
});

test("błędy wartości, znacznika i serii", () => {
  const z = "2025-02-03 05:00";
  const przypadek = (pole, tekstPola, seria = "pobor") =>
    czytaj(generuj({ ...DZIEN, podmien: [{ znacznik: z, seria, pole, tekst: tekstPola }] }).surowy);
  for (const zla of ["1.500", "1,5000", "-1,000", "1234567890,000", "", "1,"]) {
    assert.equal(przypadek("wartosc", zla).kod, "blad_wartosc", zla);
  }
  assert.equal(przypadek("wartosc", "1").ok, true, "wartość bez części dziesiętnej jest dozwolona");
  assert.equal(przypadek("wartosc", "123456789,5").ok, true);
  assert.equal(przypadek("kompletnosc", "abc").kod, "blad_wartosc");
  assert.equal(przypadek("znacznik", "2025-02-03 05:15").kod, "blad_nie_godzinowe");
  assert.equal(przypadek("znacznik", "2025-02-30 05:00").kod, "blad_data");
  assert.equal(przypadek("znacznik", "03.02.2025 05:00").kod, "blad_data");
  assert.equal(przypadek("seria", "energia czynna inna").kod, "blad_seria");
  assert.equal(przypadek("seria", "energia bierna indukcyjna pobrana").ok, true, "seria bierna z eLicznika nie jest błędem");
  assert.equal(przypadek("seria", "energia bierna pojemnościowa pobrana").ok, true, "seria bierna z eLicznika nie jest błędem");
});

test("nazwa serii: dokładnie jedna z czterech nazw z eLicznika, każda inna to blad_seria z numerem wiersza", () => {
  const z = "2025-02-03 05:00";
  const bajty = (nazwa) => generuj({ ...DZIEN, podmien: [{ znacznik: z, seria: "pobor", pole: "seria", tekst: nazwa }] }).surowy;
  for (const nazwa of [
    "energia bierna pobrana",
    "energia bierna indukcyjna pobrana Jan Kowalski",
    "energia bierna indukcyjna pobrana 600 700 800",
    "energia bierna",
    "energia czynna pobrana",
    "Energia czynna pobrana netto",
    "energia czynna pobrana netto ",
  ]) {
    const b = bajty(nazwa);
    const linia = new TextDecoder("windows-1250").decode(b).split("\r\n").findIndex((l) => l.includes(`;${nazwa};${z};`)) + 1;
    assert.ok(linia > 1, nazwa);
    assert.deepEqual(czytaj(b), { ok: false, kod: "blad_seria", wiersz: linia }, nazwa);
  }
});

test("kolumna strefy: tylko litery i pojedyncze spacje, 2–40 znaków; inaczej blad_strefa z numerem wiersza", () => {
  const z = "2025-02-03 05:00";
  const strefa = (tekst) => generuj({ ...DZIEN, podmien: [{ znacznik: z, seria: "pobor", pole: "strefa", tekst }] }).surowy;
  const przypadki = {
    "imię z adresem": "Jan Kowalski ul. Polna 5",
    "telefon z odstępami": "600 700 800",
    "11 cyfr": "12345678901",
    "8 cyfr innych niż numer płatnika": "87654321",
    "podwójna spacja": "Reszta  dnia",
    "spacja na początku": " Reszta dnia",
    "jeden znak": "A",
    "41 liter": "a".repeat(41),
    "znak spoza liter": "Reszta_dnia",
    "twarda spacja": "Reszta\u00a0dnia",
  };
  for (const [nazwa, tekst] of Object.entries(przypadki)) {
    const b = strefa(tekst);
    const linia = liniaZ(b, z, "energia czynna pobrana netto");
    assert.deepEqual(czytaj(b), { ok: false, kod: "blad_strefa", wiersz: linia }, nazwa);
  }
  for (const dobra of ["Reszta dnia", "Szczyt przedpołudniowy", "ab", "a".repeat(40), "Strefa nocna"]) {
    assert.equal(czytaj(strefa(dobra)).ok, true, dobra);
  }
});

test("kolumna strefy: najwyżej 8 różnych etykiet w pliku; dziewiąta to blad_strefa w jej wierszu", () => {
  const nazwy = ["Alfa", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];
  // Plik G13 ma już 3 etykiety; 5 nowych daje 8, szósta nowa to dziewiąta etykieta w pliku.
  const podmien = (ile) => nazwy.slice(0, ile).map((tekst, i) => ({ znacznik: `2025-02-03 0${i + 1}:00`, seria: "pobor", pole: "strefa", tekst }));
  assert.equal(czytaj(generuj({ ...DZIEN, podmien: podmien(5) }).surowy).ok, true, "8 etykiet");
  const b = generuj({ ...DZIEN, podmien: podmien(6) }).surowy;
  const linia = liniaZ(b, "2025-02-03 06:00", "energia czynna pobrana netto");
  assert.deepEqual(czytaj(b), { ok: false, kod: "blad_strefa", wiersz: linia });
});

test("brak jednej z serii czynnych: blad_brak_serii", () => {
  const linie = new TextDecoder().decode(generuj({ ...DZIEN, kodowanie: "utf-8", koniecLinii: "\n" }).surowy).split("\n");
  const bezPoboru = linie.filter((l) => !l.includes("pobrana")).join("\n");
  assert.deepEqual(czytajTauron(bezPoboru), { ok: false, kod: "blad_brak_serii" });
});

test("serie energii biernej zostają w wyniku bez zmian, z uwagą", () => {
  const w = czytaj(generuj({ ...DZIEN, bierna: true }).surowy);
  assert.equal(w.ok, true);
  assert.equal(w.wierszeDanych, 96);
  assert.ok(w.wynik.includes("energia bierna indukcyjna pobrana;2025-02-03 01:00;"));
  assert.ok(w.wynik.includes("energia bierna pojemnościowa pobrana;2025-02-03 01:00;"));
  assert.deepEqual(w.uwagi, [{ kod: "UWAGA_BIERNA" }]);
});

test("kompletność poniżej 100: uwaga z liczbą godzin", () => {
  const w = czytaj(generuj({
    ...DZIEN,
    niepelne: [{ znacznik: "2025-02-03 05:00", kompletnosc: "87,50" }, { znacznik: "2025-02-03 06:00", kompletnosc: "0,00" }],
  }).surowy);
  assert.deepEqual(w.uwagi, [{ kod: "UWAGA_KOMPLETNOSC", n: 2 }]);
  assert.ok(w.wynik.includes(";87,50\n"));
});

test("limit 50 000 wierszy danych", () => {
  assert.equal(LIMIT_WIERSZY, 50000);
  const wiersz = "energia czynna pobrana netto;2025-01-01 01:00;Reszta dnia;0,100;100,00\n";
  const tekst = "Rodzaj energii;Data i godzina;Strefa;Wartosc[kWh/kvar];Kompletnosc[%]\n" + wiersz.repeat(50001);
  assert.deepEqual(czytajTauron(tekst), { ok: false, kod: "blad_za_duzy" });
});

test("wystąpienia godziny 03:00 w dobie 25-godzinnej według sąsiedniego wiersza tej samej serii", () => {
  const wyst = (opcje) => {
    const w = czytaj(generuj({ ziarno: 3, ...opcje }).surowy);
    return w.wiersze.filter((x) => x.seria === "pobor" && x.znacznik === "2025-10-26 03:00").map((x) => x.wystapienie);
  };
  assert.deepEqual(wyst({ od: "2025-10-26", do: "2025-10-26" }), [1, 2], "para w kolejności z pliku");
  // Plik kończy się na pierwszym wierszu 03:00: poprzedni wiersz serii to 02:00.
  assert.deepEqual(wyst({ od: "2025-10-26", do: "2025-10-26", obetnijKoniec: 22 }), [1]);
  // Plik zaczyna się od drugiego wiersza 03:00: następny wiersz serii to 04:00.
  assert.deepEqual(wyst({ od: "2025-10-26", do: "2025-10-26", obetnijPoczatek: 3 }), [2]);
  // Jeden wiersz 03:00 w środku, między 02:00 a 04:00: pierwsze wystąpienie, drugiego brak.
  const bezDrugiego = new TextDecoder("windows-1250")
    .decode(generuj({ od: "2025-10-26", do: "2025-10-26", ziarno: 3 }).surowy)
    .split("\r\n");
  const druga = bezDrugiego.findLastIndex((l) => l.includes("pobrana netto;2025-10-26 03:00;"));
  bezDrugiego.splice(druga, 1);
  const w = czytajTauron(bezDrugiego.join("\r\n"));
  assert.deepEqual(w.wiersze.filter((x) => x.seria === "pobor" && x.znacznik === "2025-10-26 03:00").map((x) => x.wystapienie), [1]);
});

test("wiersze wyniku niosą godzinę, porządek i wartość w Wh", () => {
  const w = czytaj(generuj(N1).surowy);
  const pierwszy = w.wiersze[0];
  assert.equal(pierwszy.seria, "oddanie");
  assert.deepEqual(pierwszy.doba, { rok: 2025, miesiac: 6, dzien: 6 });
  assert.equal(pierwszy.godzina, 0);
  assert.equal(pierwszy.wystapienie, 1);
  assert.equal(pierwszy.linia, 2);
  const zWartoscia = w.wiersze.find((x) => x.seria === "oddanie" && x.znacznik === "2025-06-06 08:00");
  assert.equal(zWartoscia.wh, 4242);
  assert.equal(w.wiersze.at(-1).seria, "pobor");
  assert.deepEqual(w.wiersze.at(-1).doba, { rok: 2025, miesiac: 6, dzien: 7 });
  assert.equal(w.wiersze.at(-1).godzina, 23);
});
