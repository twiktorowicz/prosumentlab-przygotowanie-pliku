// Formy liczby, wstawki i polski zapis dat w tekstach dla klienta.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formaLiczby,
  wypelnij,
  tekst,
  dataPolska,
  znacznikPolski,
  miesiacZRokiem,
  kwhDoWyswietlenia,
} from "../app/lib/odmiana.js";

test("formy liczby: pełna reguła polska", () => {
  const oczekiwane = {
    1: "jeden", 2: "kilka", 3: "kilka", 4: "kilka", 5: "wiele", 11: "wiele", 12: "wiele", 13: "wiele",
    14: "wiele", 15: "wiele", 21: "wiele", 22: "kilka", 24: "kilka", 25: "wiele", 102: "kilka", 112: "wiele", 0: "wiele",
  };
  for (const [n, forma] of Object.entries(oczekiwane)) assert.equal(formaLiczby(+n), forma, n);
});

test("wstawki: wszystkie podane, nieznana albo brakująca to błąd", () => {
  assert.equal(wypelnij("Plik {plik}, zgłoszenie {numer}.", { plik: "a.zip", numer: "K7M3-Q9TX" }), "Plik a.zip, zgłoszenie K7M3-Q9TX.");
  assert.throws(() => wypelnij("Plik {plik}.", {}));
  assert.throws(() => wypelnij("Plik {nieznana}.", { nieznana: "x" }));
});

test("tekst z formami liczby", () => {
  const TEKSTY = {
    zakres: { jeden: "{n} pełny miesiąc", kilka: "{n} pełne miesiące", wiele: "{n} pełnych miesięcy" },
    prosty: "Numer {numer}.",
  };
  assert.equal(tekst(TEKSTY, "zakres", { n: 1 }), "1 pełny miesiąc");
  assert.equal(tekst(TEKSTY, "zakres", { n: 22 }), "22 pełne miesiące");
  assert.equal(tekst(TEKSTY, "zakres", { n: 12 }), "12 pełnych miesięcy");
  assert.equal(tekst(TEKSTY, "prosty", { numer: "K7M3-Q9TX" }), "Numer K7M3-Q9TX.");
  assert.throws(() => tekst(TEKSTY, "brak"));
  assert.throws(() => tekst(TEKSTY, "zakres", {}), "forma liczby wymaga {n}");
});

test("daty: dzień bez zera wiodącego, miesiąc z dwoma cyframi, „r.”", () => {
  assert.equal(dataPolska({ rok: 2022, miesiac: 11, dzien: 19 }), "19.11.2022 r.");
  assert.equal(dataPolska({ rok: 2024, miesiac: 7, dzien: 1 }), "1.07.2024 r.");
  assert.equal(znacznikPolski("2026-10-25 03:00"), "25.10.2026 r., 03:00");
  assert.equal(znacznikPolski("2026-01-05 24:00"), "5.01.2026 r., 24:00");
});

test("miesiąc z rokiem w dopełniaczu", () => {
  const nazwy = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];
  assert.equal(miesiacZRokiem(2025, 1, nazwy), "stycznia 2025 r.");
  assert.equal(miesiacZRokiem(2026, 10, nazwy), "października 2026 r.");
});

test("kWh do wyświetlenia: zaokrąglenie połówek w górę, odstęp tysięcy od pięciu cyfr", () => {
  assert.equal(kwhDoWyswietlenia(0), "0");
  assert.equal(kwhDoWyswietlenia(499), "0");
  assert.equal(kwhDoWyswietlenia(500), "1");
  assert.equal(kwhDoWyswietlenia(246047), "246");
  assert.equal(kwhDoWyswietlenia(2880400), "2880");
  assert.equal(kwhDoWyswietlenia(16000000), "16 000");
  assert.equal(kwhDoWyswietlenia(1234567890), "1 234 568");
});
