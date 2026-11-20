// Odczyt kwot, cen, energii, liczb z sekcji o instalacji i pól na dowolny tekst.
// Wszystko na tekście, bez liczb zmiennoprzecinkowych. Przykłady są zmyślone.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  czytajKwote,
  czytajCene,
  czytajDziesietna,
  czytajTekstWolny,
  liczbaZCyfr,
} from "../app/lib/kwoty.js";

const wartosc = (w) => (w.ok ? w.wartosc : "błąd");

test("N16: kwoty", () => {
  const przypadki = [
    ["12,34", "12.34"],
    ["12.34", "12.34"],
    ["1 234,5", "1234.50"],
    ["10", "10.00"],
    ["12,340", "12.34"], // zera na końcu są dozwolone, jak w kolumnie cen na fakturze
    ["12,3,4", "błąd"],
    ["-3,00", "błąd"],
    ["9999,99", "9999.99"], // najwyżej 4 cyfry przed przecinkiem
    ["9 999,99", "9999.99"],
    ["10000", "błąd"],
    ["10 000,00", "błąd"],
    ["9".repeat(15), "błąd"],
  ];
  for (const [wejscie, oczekiwane] of przypadki) assert.equal(wartosc(czytajKwote(wejscie)), oczekiwane, wejscie);
});

test("kwoty: zera na końcu jak w kolumnie „Cena netto (zł)” na fakturze, zapis z dwoma miejscami", () => {
  assert.equal(wartosc(czytajKwote("12,34000")), "12.34");
  assert.equal(wartosc(czytajKwote("0,00000")), "0.00");
  assert.equal(wartosc(czytajKwote("4,50000")), "4.50");
  assert.equal(wartosc(czytajKwote("12,341")), "błąd");
  assert.equal(wartosc(czytajKwote("12,34001")), "błąd");
  assert.equal(wartosc(czytajKwote("12,3400,0")), "błąd");
});

test("kwoty: separator tysięcy tylko w grupach po trzy cyfry, także twarda spacja", () => {
  assert.equal(wartosc(czytajKwote("12 34")), "błąd");
  assert.equal(wartosc(czytajKwote("1 234 567,8")), "błąd", "7 cyfr przed przecinkiem");
  assert.equal(wartosc(czytajKwote("1\u00a0234,50")), "1234.50");
  assert.equal(wartosc(czytajKwote("1\u202f234")), "1234.00");
  assert.equal(wartosc(czytajKwote("1234 567")), "błąd");
  assert.equal(wartosc(czytajKwote(" 7,5 ")), "7.50");
});

test("kwoty: inne błędy formatu", () => {
  for (const zle of ["", "  ", "12,", ",5", "1.234,50", "1,234.50", "12a", "12 ,34", "+3", "1e3"]) {
    assert.equal(czytajKwote(zle).ok, false, JSON.stringify(zle));
  }
  assert.equal(wartosc(czytajKwote("0")), "0.00");
  assert.equal(wartosc(czytajKwote("007,1")), "7.10");
});

test("N17: ceny", () => {
  assert.equal(wartosc(czytajCene("0,51234")), "0.51234");
  assert.equal(wartosc(czytajCene("0,5")), "0.50");
  assert.equal(wartosc(czytajCene("0,1234567")), "błąd");
});

test("ceny: od 0 do 6 miejsc po przecinku, zapis z co najmniej dwoma miejscami", () => {
  const przypadki = [
    ["1", "1.00"], ["0,6", "0.60"], ["0", "0.00"], ["0,50", "0.50"], ["0,51234", "0.51234"],
    ["1.123456", "1.123456"], ["9,99", "9.99"], ["007,50", "7.50"], [" 0,62 ", "0.62"],
  ];
  for (const [wejscie, oczekiwane] of przypadki) assert.equal(wartosc(czytajCene(wejscie)), oczekiwane, wejscie);
  for (const zle of ["0,1234567", "-0,50", "1,", ",5", "", "0,5a", "+1"]) {
    assert.deepEqual(czytajCene(zle), { ok: false }, JSON.stringify(zle));
  }
});

test("ceny: od 10 zł/kWh w górę to cena w groszach", () => {
  for (const grosze of ["10", "51", "99,50", "100,50", "62,345", "1 234", `${"9".repeat(8)},00`, "0010,00"]) {
    assert.deepEqual(czytajCene(grosze), { ok: false, kod: "faktura_cena_grosze" }, grosze);
  }
  assert.equal(wartosc(czytajCene("0009,999999")), "9.999999", "zera wiodące się nie liczą");
});

test("liczby z sekcji o instalacji: do 2 miejsc, najwyżej 3 cyfry przed przecinkiem, większe od zera", () => {
  const moc = (t) => wartosc(czytajDziesietna(t, { calkowitych: 3, miejsc: 2, dodatnia: true }));
  assert.equal(moc("7,2"), "7.20");
  assert.equal(moc("12"), "12.00");
  assert.equal(moc("999,99"), "999.99");
  assert.equal(moc("1000"), "błąd");
  assert.equal(moc("0"), "błąd");
  assert.equal(moc("0,00"), "błąd");
  assert.equal(moc("0,01"), "0.01");
  assert.equal(moc("7,255"), "błąd");
});

test("N18: pola na dowolny tekst", () => {
  const przypadki = [
    ["Opłata handlowa", true],
    ["Prąd 2025", true],
    ["Jan@x", false],
    ["31-123", false],
    ["Taryfa 1234", true], // 4 cyfry poza latami są dozwolone
    ["Oferta 2025 123", true],
    ["Oferta 1999", true],
    ["Oferta 12345", false],
    ["a".repeat(61), false],
  ];
  for (const [wejscie, dobre] of przypadki) assert.equal(czytajTekstWolny(wejscie).ok, dobre, wejscie);
});

test("pola na dowolny tekst: separatory między cyframi, krótkie ciągi, przycinanie", () => {
  assert.equal(czytajTekstWolny("12.345").ok, false);
  assert.equal(czytajTekstWolny("12/34/5").ok, false);
  assert.equal(czytajTekstWolny("Taryfa G12w").ok, true);
  assert.equal(czytajTekstWolny("Opcja 123").ok, true);
  assert.equal(czytajTekstWolny("Rok 2099").ok, true);
  assert.equal(czytajTekstWolny("Rok 2100").ok, true, "4 cyfry, choć nie rok");
  assert.equal(czytajTekstWolny("a".repeat(60)).ok, true);
  assert.equal(czytajTekstWolny("ą".repeat(60)).ok, true, "limit liczony w znakach");
  assert.deepEqual(czytajTekstWolny("  Opłata handlowa "), { ok: true, wartosc: "Opłata handlowa" });
});

test("pola na dowolny tekst: tekst dłuższy niż 120 jednostek UTF-16 odrzucony przed składaniem", () => {
  // 60 liter zapisanych jako litera i znak łączący to 120 jednostek; po złożeniu 60 znaków.
  assert.equal(czytajTekstWolny("ą".repeat(60)).ok, true);
  assert.equal(czytajTekstWolny(`${"ą".repeat(60)} `).ok, false, "121 jednostek");
  assert.equal(czytajTekstWolny("a".repeat(100000)).ok, false);
});

test("pola na dowolny tekst: bez znaków sterujących, także nowej linii i tabulatora", () => {
  for (const zly of ["Opłata\nhandlowa", "Opłata\thandlowa", "Opłata\rhandlowa", "Opłata\u0007", "\u0000Opłata", "Opłata handlowa\n", "Opłata\u0085x"]) {
    assert.equal(czytajTekstWolny(zly).ok, false, JSON.stringify(zly));
  }
  assert.equal(czytajTekstWolny("Opłata handlowa").ok, true);
});

test("pola na dowolny tekst: tylko litery, cyfry ASCII, spacja i znaki . , - / ( ) + & ' %", () => {
  const zle = {
    "cyfry z niewidocznym znakiem między nimi": "Nr 123\u200b45",
    "cyfry z niewidocznym łącznikiem": "Nr 12\u2060345",
    "cyfry pełnej szerokości": "Nr \uff11\uff12\uff13\uff14\uff15",
    "znak zmiany kierunku pisma": "Opłata \u202ehandlowa",
    "znak kierunku pisma (izolacja)": "Opłata \u2066handlowa",
    "twarda spacja w środku": "Opłata\u00a0handlowa",
    "podkreślenie": "Opłata_handlowa",
    "krzyżyk": "Opłata #1",
    "dwukropek": "Opłata: handlowa",
    "cyfry arabsko-indyjskie": "Nr \u0661\u0662\u0663",
    "emoji": "Opłata \u{1F4A1}",
  };
  for (const [nazwa, tekst] of Object.entries(zle)) assert.equal(czytajTekstWolny(tekst).ok, false, nazwa);
  for (const dobry of ["Opłata handlowa", "Taryfa G12w", "Opłata (stała) 50%", "A&B Energia", "Prąd + gaz", "Opłata d'Arc", "Sprzedawca, S.A.", "Plan 1/2"]) {
    assert.equal(czytajTekstWolny(dobry).ok, true, dobry);
  }
  // Litera zapisana jako litera i znak łączący (np. z kopiowania) jest przyjęta po złożeniu.
  assert.deepEqual(czytajTekstWolny("Opa\u0328ta"), { ok: true, wartosc: "Opąta" });
});

test("pola na nazwę: grupy cyfr, najwyżej dwa lata 2000–2099 pomijane, poza nimi najwyżej 4 cyfry", () => {
  for (const dobry of ["Taryfa G12 2026", "G12w 2025/2026", "E.ON", "Opłata OZE", "ul. Polna 12/4", "Plan 2025 2026 12", "Opcja 1234"]) {
    assert.equal(czytajTekstWolny(dobry).ok, true, dobry);
  }
  for (const zly of ["(+48) 600,123,456", "90,01,01,123,45", "600 123 456", "40-001", "12345", "Plan 2025 2026 2027 12",
    "Opcja 12 345", "Opłata (12)(34)(5)", "Nr 2000,2001,2002,1"]) {
    assert.equal(czytajTekstWolny(zly).ok, false, zly);
  }
});

test("liczby z cyfr", () => {
  assert.equal(liczbaZCyfr("0042"), 42);
  assert.equal(liczbaZCyfr("4a"), null);
  assert.equal(liczbaZCyfr(""), null);
});
