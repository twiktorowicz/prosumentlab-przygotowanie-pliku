// Wiersz poleceń narzedzia/przygotuj.mjs i N15 (wynik niezależny od strefy czasowej).
// Pliki wejściowe powstają z generatora w katalogu tymczasowym systemu.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { generuj } from "../narzedzia/generator.mjs";
import { przygotujZgloszenie } from "../app/lib/zgloszenie.js";
import { czytajZip } from "./pomoc/czytnik-zip.mjs";

const SKRYPT = fileURLToPath(new URL("../narzedzia/przygotuj.mjs", import.meta.url));
const WZORZEC_N1 = readFileSync(fileURLToPath(new URL("wzorce/n1_wyjscie.csv", import.meta.url)));
const NUMER = "K7M3-Q9TX";
const DATA = "2026-11-19";
const N1 = { od: "2025-06-06", do: "2025-06-07", taryfa: "G13", ziarno: 1 };

let katalog;
before(() => {
  katalog = mkdtempSync(join(tmpdir(), "przygotuj-"));
});
after(() => {
  rmSync(katalog, { recursive: true, force: true });
});

function zapisz(nazwa, bajty) {
  const sciezka = join(katalog, nazwa);
  writeFileSync(sciezka, bajty);
  return sciezka;
}

function uruchom(argumenty, env = {}) {
  const w = spawnSync(process.execPath, [SKRYPT, ...argumenty], { env: { ...process.env, ...env }, encoding: "utf8" });
  return { kod: w.status, stdout: w.stdout, stderr: w.stderr };
}

test("zapis ZIP-a: kod 0, ten sam ZIP co funkcja w przeglądarce", () => {
  const plik = zapisz("n1.csv", generuj(N1).surowy);
  const formularz = { faktura: { oplata_mocowa_zl_mies: "12,34" }, instalacja: { magazyn: "nie" }, zgoda: true };
  const sciezkaFormularza = zapisz("formularz.json", JSON.stringify(formularz));
  const wyjscie = join(katalog, "wynik.zip");
  const w = uruchom(["--numer", NUMER, "--data", DATA, "--formularz", sciezkaFormularza, "--wyjscie", wyjscie, plik]);
  assert.equal(w.kod, 0, w.stderr);
  assert.equal(w.stderr, "");
  const oczekiwany = przygotujZgloszenie({ pliki: [generuj(N1).surowy], formularz, numer: NUMER, utworzono: DATA }).zip;
  assert.deepEqual(new Uint8Array(readFileSync(wyjscie)), oczekiwany);
  const pliki = czytajZip(readFileSync(wyjscie));
  assert.deepEqual(pliki.map((p) => p.nazwa), ["zgloszenie.json", "faktury.json", "instalacja.json", "pomiary_1.csv"]);
  assert.deepEqual(Buffer.from(pliki[3].bajty), WZORZEC_N1);
  // Na standardowym wyjściu tylko kody uwag z miejscem, bez danych.
  assert.equal(w.stdout, "uwaga ZAKRES_NIEPELNY zakres\nuwaga FAKTURA_BRAK_OBOWIAZKOWYCH raport\n");
});

test("bez formularza: pusty formularz", () => {
  const plik = zapisz("n1b.csv", generuj(N1).surowy);
  const wyjscie = join(katalog, "bez.zip");
  const w = uruchom(["--numer", NUMER, "--data", DATA, "--wyjscie", wyjscie, plik]);
  assert.equal(w.kod, 0, w.stderr);
  assert.deepEqual(czytajZip(readFileSync(wyjscie)).map((p) => p.nazwa), ["zgloszenie.json", "pomiary_1.csv"]);
});

test("blokada: kod 1, ZIP nie powstaje, na stderr tylko kody i numery wierszy", () => {
  const plik = zapisz("bezpiecznik.csv", generuj({ ...N1, ppeWStrefie: { znacznik: "2025-06-06 05:00", seria: "pobor" } }).surowy);
  const wyjscie = join(katalog, "blokada.zip");
  const w = uruchom(["--numer", NUMER, "--data", DATA, "--wyjscie", wyjscie, plik]);
  assert.equal(w.kod, 1);
  assert.equal(existsSync(wyjscie), false);
  assert.match(w.stderr, /^plik 1: blad_bezpiecznik wiersz \d+$/m);
  assert.doesNotMatch(w.stderr, /590|10000001|PPE:/);
});

test("plik nieczytelny: kod 1 i ZIP nie powstaje, choć strona by go pominęła", () => {
  const dobry = zapisz("dobry.csv", generuj(N1).surowy);
  const arkusz = zapisz("arkusz.xlsx", new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  const wyjscie = join(katalog, "arkusz.zip");
  const w = uruchom(["--numer", NUMER, "--data", DATA, "--wyjscie", wyjscie, dobry, arkusz]);
  assert.equal(w.kod, 1);
  assert.equal(existsSync(wyjscie), false);
  assert.equal(w.stderr, "plik 2: blad_arkusz\n");
});

test("sprzeczne pliki i błąd pola: kod 1 z kodami", () => {
  const a = zapisz("a.csv", generuj({ od: "2025-01-01", do: "2025-01-10", ziarno: 3 }).surowy);
  const b = zapisz("b.csv", generuj({ od: "2025-01-05", do: "2025-01-20", ziarno: 4 }).surowy);
  const formularz = zapisz("zly.json", JSON.stringify({ faktura: { oplata_mocowa_zl_mies: "12,345" } }));
  const w = uruchom(["--numer", NUMER, "--data", DATA, "--formularz", formularz, "--wyjscie", join(katalog, "x.zip"), a, b]);
  assert.equal(w.kod, 1);
  assert.equal(w.stderr, "blokada: blad_sprzeczne\npole oplata_mocowa_zl_mies: faktura_kwota_format\n");
});

test("złe wywołanie: kod 2 i komunikat o tym, co jest nie tak", () => {
  const plik = zapisz("n1c.csv", generuj(N1).surowy);
  const wyjscie = join(katalog, "z.zip");
  const przypadki = [
    [[], /^przygotuj: --numer: oczekiwany XXXX-XXXX\n$/],
    [["--numer", NUMER, "--data", DATA, "--wyjscie", wyjscie], /^przygotuj: podaj co najmniej jeden plik\n$/],
    [["--numer", "K7M3-Q9TI", "--data", DATA, "--wyjscie", wyjscie, plik], /^przygotuj: --numer: oczekiwany XXXX-XXXX\n$/],
    [["--numer", NUMER, "--data", "2026-02-30", "--wyjscie", wyjscie, plik], /^przygotuj: --data: oczekiwany istniejący dzień RRRR-MM-DD\n$/],
    [["--numer", NUMER, "--data", DATA, plik], /^przygotuj: --wyjscie: wymagane\n$/],
    [["--numer", NUMER, "--data", DATA, "--wyjscie", wyjscie, "--formularz", zapisz("zepsuty.json", "{"), plik], /^przygotuj: --formularz: nie da się odczytać pliku JSON\n$/],
    [["--numer", NUMER, "--data", DATA, "--wyjscie", wyjscie, join(katalog, "nie-ma.csv")], /^przygotuj: nie da się odczytać pliku wejściowego\n$/],
    [["--nieznana", "x"], /^przygotuj: .*--nieznana/],
  ];
  for (const [argumenty, komunikat] of przypadki) {
    const w = uruchom(argumenty);
    assert.equal(w.kod, 2, argumenty.join(" "));
    assert.match(w.stderr, komunikat, argumenty.join(" "));
  }
  assert.equal(existsSync(wyjscie), false);
});

test("formularz o złej budowie: kod 2 z nazwą klucza, bez wartości", () => {
  const plik = zapisz("n1d.csv", generuj(N1).surowy);
  const wyjscie = join(katalog, "budowa.zip");
  const TAJNE = "WARTOSC_TAJNA";
  const przypadki = [
    [[], "formularz"],
    ["tekst", "formularz"],
    [null, "formularz"],
    [{ fakturaa: {} }, "fakturaa"],
    [{ faktura: TAJNE }, "faktura"],
    [{ faktura: { oplata_mocowa: TAJNE } }, "faktura.oplata_mocowa"],
    [{ faktura: { oplata_mocowa_zl_mies: 12.34 } }, "faktura.oplata_mocowa_zl_mies"],
    [{ faktura: { cena_energii_netto_zl_kwh: { a: TAJNE } } }, "faktura.cena_energii_netto_zl_kwh"],
    [{ faktura: { cena_energii_netto_zl_kwh: ["0,50", 1] } }, "faktura.cena_energii_netto_zl_kwh[1]"],
    [{ faktura: { oplaty_stale_inne: { nazwa: TAJNE } } }, "faktura.oplaty_stale_inne"],
    [{ faktura: { oplaty_stale_inne: [{ nazwa: TAJNE, kwota: "1,00" }] } }, "faktura.oplaty_stale_inne[0].kwota"],
    [{ faktura: { oplaty_stale_inne: [TAJNE] } }, "faktura.oplaty_stale_inne[0]"],
    [{ instalacja: { moc: TAJNE } }, "instalacja.moc"],
    [{ instalacja: { zmiany: [{ rodzaj: "pompa_ciepla", miesiac: 202510 }] } }, "instalacja.zmiany[0].miesiac"],
    [{ instalacja: { zmiany: TAJNE } }, "instalacja.zmiany"],
    [{ zgoda: "true" }, "zgoda"],
    [{ zgoda: 1 }, "zgoda"],
  ];
  for (const [formularz, klucz] of przypadki) {
    const sciezka = zapisz("budowa.json", JSON.stringify(formularz));
    const w = uruchom(["--numer", NUMER, "--data", DATA, "--formularz", sciezka, "--wyjscie", wyjscie, plik]);
    assert.equal(w.kod, 2, JSON.stringify(formularz));
    assert.ok(w.stderr.includes(klucz), `${JSON.stringify(formularz)}: ${w.stderr}`);
    assert.equal(w.stderr.includes(TAJNE), false, "bez wartości na stderr");
  }
  assert.equal(existsSync(wyjscie), false);
});

test("formularz poprawnej budowy z każdym kluczem przechodzi", () => {
  const plik = zapisz("n1e.csv", generuj(N1).surowy);
  const formularz = {
    faktura: {
      sprzedawca: "inny", sprzedawca_nazwa: "Sprzedawca", operator_dystrybucyjny: "inny", taryfa: "inna", taryfa_nazwa: "Taryfa",
      okres_od: "2025-06-06", okres_do: "2025-06-07", rodzaj_faktury: "korekta", system_rozliczenia: "nie_wiem",
      rodzaj_ceny: "stala", cena_energii_netto_zl_kwh: ["0,50", "0,40"], oplata_mocowa_zl_mies: "1,00",
      oplata_abonamentowa_zl_mies: "1,00", oplata_stala_sieciowa_zl_mies: "1,00", oplata_przejsciowa_zl_mies: "",
      oplaty_stale_inne: [{ nazwa: "Opłata handlowa", kwota_zl_mies: "9,99" }],
    },
    instalacja: {
      moc_pv_kwp: "5", magazyn: "tak", magazyn_pojemnosc_kwh: "5", magazyn_od: "2025-01",
      pierwsze_oddanie: "nie_wiem", zmiany: [{ rodzaj: "rozbudowa_pv", miesiac: "2025-06" }],
    },
    zgoda: false,
  };
  const w = uruchom(["--numer", NUMER, "--data", DATA, "--formularz", zapisz("pelny.json", JSON.stringify(formularz)), "--wyjscie", join(katalog, "pelny.zip"), plik]);
  assert.equal(w.kod, 0, w.stderr);
});

test("pomoc", () => {
  const w = uruchom(["--help"]);
  assert.equal(w.kod, 0);
  assert.match(w.stdout, /--numer/);
  assert.match(w.stdout, /Kody wyjścia/);
});

test("N15: N1 i N13 w procesach z różną strefą czasową dają ZIP-y identyczne co do bajtu", () => {
  const scenariusze = {
    n1: [generuj(N1).surowy],
    "n13-12": [generuj({ od: "2025-01-01", do: "2025-12-31", ziarno: 13 }).surowy],
    "n13-11": [generuj({ od: "2024-12-01", do: "2025-10-31", ziarno: 13 }).surowy],
    "n13-5": [generuj({ od: "2025-01-01", do: "2025-05-31", ziarno: 13 }).surowy],
  };
  for (const [nazwa, pliki] of Object.entries(scenariusze)) {
    const sciezki = pliki.map((bajty, i) => zapisz(`${nazwa}-${i}.csv`, bajty));
    const zipy = ["Pacific/Auckland", "America/New_York", "UTC"].map((tz) => {
      const wyjscie = join(katalog, `${nazwa}-${tz.replace("/", "_")}.zip`);
      const w = uruchom(["--numer", NUMER, "--data", DATA, "--wyjscie", wyjscie, ...sciezki], { TZ: tz });
      assert.equal(w.kod, 0, `${nazwa} ${tz}: ${w.stderr}`);
      return readFileSync(wyjscie);
    });
    assert.deepEqual(zipy[1], zipy[0], `${nazwa}: New York a Auckland`);
    assert.deepEqual(zipy[2], zipy[0], `${nazwa}: UTC a Auckland`);
  }
  const zakres = (nazwa) => JSON.parse(new TextDecoder().decode(czytajZip(readFileSync(join(katalog, `${nazwa}-UTC.zip`)))[0].bajty)).zakres.klasyfikacja;
  assert.deepEqual(["n13-12", "n13-11", "n13-5"].map(zakres), ["raport", "wynik_wstepny", "za_krotki"]);
});
