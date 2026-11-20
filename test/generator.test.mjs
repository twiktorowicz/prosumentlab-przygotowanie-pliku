// Testy generatora danych syntetycznych (narzedzia/generator.mjs) i test N24.
// Generator jest jedynym źródłem danych testowych, więc sprawdzamy go osobno, zanim posłuży
// do testów narzędzia.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  generuj,
  PPE_FIKCYJNE,
  PLATNICY_FIKCYJNI,
  NAGLOWEK_SUROWY,
  NAGLOWEK_BEZ_NUMEROW,
  SERIA_ODDANIE,
  SERIA_POBOR,
  SERIE_BIERNE,
} from "../narzedzia/generator.mjs";

const KORZEN = fileURLToPath(new URL("..", import.meta.url));
const WZORZEC_N1 = join(KORZEN, "test", "wzorce", "n1_wyjscie.csv");
const PARAMETRY_N1 = { od: "2025-06-06", do: "2025-06-07", taryfa: "G13", ziarno: 1 };

const dekodujIso = (bajty) => new TextDecoder("iso-8859-2").decode(bajty);
const dekodujUtf8 = (bajty) => new TextDecoder("utf-8", { fatal: true }).decode(bajty);

// Wiersze danych pliku bez numerów jako tablice pól, bez nagłówka.
function wiersze(wynik) {
  const linie = dekodujUtf8(wynik.bezNumerow).split("\n");
  assert.equal(linie.pop(), "", "plik kończy się znakiem LF");
  assert.equal(linie.shift(), NAGLOWEK_BEZ_NUMEROW);
  return linie.map((l) => l.split(";"));
}

const seria = (w, nazwa) => w.filter((p) => p[0] === nazwa);

// Cyfra kontrolna GS1 dla 17 cyfr bez cyfry kontrolnej: wagi 3 i 1 na przemian od prawej,
// cyfra dopełnia sumę do wielokrotności 10. Liczona tu niezależnie od generatora.
function cyfraKontrolnaGs1(cyfry17) {
  let suma = 0;
  for (let i = 0; i < cyfry17.length; i++) {
    const cyfra = cyfry17.charCodeAt(cyfry17.length - 1 - i) - 48;
    suma += cyfra * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (suma % 10)) % 10;
}

test("N24: oba fikcyjne PPE mają błędną cyfrę kontrolną GS1", () => {
  assert.deepEqual(PPE_FIKCYJNE, ["590000000000000010", "590000000000000021"]);
  const oczekiwane = [3, 0];
  PPE_FIKCYJNE.forEach((ppe, i) => {
    assert.equal(ppe.length, 18);
    const poprawna = cyfraKontrolnaGs1(ppe.slice(0, 17));
    assert.equal(poprawna, oczekiwane[i]);
    assert.notEqual(ppe.charCodeAt(17) - 48, poprawna, `${ppe} nie może mieć poprawnej cyfry`);
  });
});

test("fikcyjni płatnicy mają 8 cyfr", () => {
  assert.deepEqual(PLATNICY_FIKCYJNI, ["10000001", "10000002"]);
  for (const p of PLATNICY_FIKCYJNI) assert.match(p, /^\d{8}$/);
});

test("plik surowy: ISO-8859-2, CRLF, 7 kolumn, polskie znaki w etykietach stref", () => {
  const wynik = generuj(PARAMETRY_N1);
  assert.throws(() => dekodujUtf8(wynik.surowy), "plik surowy nie jest poprawnym UTF-8");
  const tekst = dekodujIso(wynik.surowy);
  assert.ok(tekst.endsWith("\r\n"));
  const linie = tekst.slice(0, -2).split("\r\n");
  assert.equal(linie[0], NAGLOWEK_SUROWY);
  assert.equal(linie.length, 1 + 96);
  for (const l of linie.slice(1)) {
    const pola = l.split(";");
    assert.equal(pola.length, 7);
    assert.equal(pola[0], PLATNICY_FIKCYJNI[0]);
    assert.equal(pola[1], `PPE:${PPE_FIKCYJNE[0]}`, "kolumna PPE jak w eLiczniku");
  }
  assert.ok(tekst.includes("Szczyt przedpołudniowy"));
  // Bajt 0xB3 to „ł” w ISO-8859-2 (tak samo w Windows-1250).
  assert.ok(wynik.surowy.includes(0xb3));
});

test("tablica ISO-8859-2: każda polska litera odczytana niezależnym dekoderem wychodzi bez zmian", () => {
  const litery = "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ";
  const wynik = generuj({ od: "2025-02-03", do: "2025-02-03", ziarno: 1, podmien: [{ znacznik: "2025-02-03 05:00", seria: "pobor", pole: "strefa", tekst: litery }] });
  assert.ok(dekodujIso(wynik.surowy).includes(`;${litery};`));
  // Dwie litery widziane na prawdziwym pliku: „ł” = B3, „ś” = B6.
  assert.ok(wynik.surowy.includes(0xb3) && wynik.surowy.includes(0xb6));
});

test("N1, wzorzec: dwie doby G13 dają zapisany plik bez numerów (UTF-8, LF)", () => {
  const wynik = generuj(PARAMETRY_N1);
  assert.deepEqual(Buffer.from(wynik.bezNumerow), readFileSync(WZORZEC_N1));
});

test("wariant bez numerów to surowy bez dwóch pierwszych kolumn", () => {
  const wynik = generuj(PARAMETRY_N1);
  const surowe = dekodujIso(wynik.surowy).slice(0, -2).split("\r\n").slice(1);
  const bezNumerow = wiersze(wynik);
  assert.equal(surowe.length, bezNumerow.length);
  surowe.forEach((l, i) => assert.deepEqual(l.split(";").slice(2), bezNumerow[i]));
});

test("seria oddania przed serią poboru, formaty wartości i kompletności", () => {
  const w = wiersze(generuj(PARAMETRY_N1));
  assert.ok(w.slice(0, 48).every((p) => p[0] === SERIA_ODDANIE));
  assert.ok(w.slice(48).every((p) => p[0] === SERIA_POBOR));
  for (const p of w) {
    assert.match(p[1], /^\d{4}-\d{2}-\d{2} \d{2}:00$/);
    assert.match(p[3], /^\d{1,9},\d{3}$/);
    assert.equal(p[4], "100,00");
  }
  assert.ok(w.some((p) => p[3] === "0,000"), "zero zapisane jako 0,000");
});

test("bilans godzinowy: w każdej godzinie dokładnie jedna z serii jest niezerowa", () => {
  const w = wiersze(generuj({ od: "2025-01-01", do: "2025-12-31", taryfa: "G13", ziarno: 7 }));
  const oddanie = seria(w, SERIA_ODDANIE);
  const pobor = seria(w, SERIA_POBOR);
  assert.equal(oddanie.length, pobor.length);
  oddanie.forEach((o, i) => {
    assert.equal(o[1], pobor[i][1]);
    const niezerowe = [o[3], pobor[i][3]].filter((v) => v !== "0,000").length;
    assert.equal(niezerowe, 1, `godzina ${o[1]}`);
  });
  assert.ok(oddanie.some((p) => p[3] !== "0,000"), "jest oddanie");
});

test("północ to 00:00 następnego dnia, także na przełomie roku", () => {
  const w = seria(wiersze(generuj({ od: "2025-12-31", do: "2025-12-31", ziarno: 1 })), SERIA_POBOR);
  assert.equal(w[0][1], "2025-12-31 01:00");
  assert.equal(w.at(-1)[1], "2026-01-01 00:00");
  assert.ok(!w.some((p) => p[1].endsWith("24:00")));
});

test("doba 23-godzinna bez 03:00 i doba 25-godzinna z dwoma 03:00", () => {
  const marzec = seria(wiersze(generuj({ od: "2025-03-30", do: "2025-03-30", ziarno: 1 })), SERIA_POBOR);
  assert.equal(marzec.length, 23);
  assert.ok(!marzec.some((p) => p[1] === "2025-03-30 03:00"));
  const pazdziernik = seria(wiersze(generuj({ od: "2025-10-26", do: "2025-10-26", ziarno: 1 })), SERIA_POBOR);
  assert.equal(pazdziernik.length, 25);
  assert.equal(pazdziernik.filter((p) => p[1] === "2025-10-26 03:00").length, 2);
});

test("liczba godzin miesiąca: III 2025 = 743, X 2025 = 745, II 2024 = 696", () => {
  const godziny = (od, doDnia) =>
    seria(wiersze(generuj({ od, do: doDnia, ziarno: 1 })), SERIA_POBOR).length;
  assert.equal(godziny("2025-03-01", "2025-03-31"), 743);
  assert.equal(godziny("2025-10-01", "2025-10-31"), 745);
  assert.equal(godziny("2024-02-01", "2024-02-29"), 696);
});

test("strefy G13: dni robocze lato i zima, sobota, święta; G11 cała doba „Reszta dnia”", () => {
  const strefy = (dzien, taryfa = "G13") => {
    const w = seria(wiersze(generuj({ od: dzien, do: dzien, taryfa, ziarno: 1 })), SERIA_POBOR);
    return w.map((p) => p[2]);
  };
  const doba = (przed, popo) =>
    Array.from({ length: 24 }, (_, start) =>
      start >= 7 && start < 13
        ? "Szczyt przedpołudniowy"
        : start >= popo[0] && start < popo[1]
          ? "Szczyt popołudniowy"
          : "Reszta dnia",
    );
  // Środa 16.04.2025 (lato) i środa 15.01.2025 (zima). Etykieta według godziny początku:
  // znacznik 08:00 kończy godzinę 7:00–8:00.
  assert.deepEqual(strefy("2025-04-16"), doba([7, 13], [19, 22]));
  assert.deepEqual(strefy("2025-01-15"), doba([7, 13], [16, 21]));
  const resztaDoby = Array(24).fill("Reszta dnia");
  assert.deepEqual(strefy("2025-04-19"), resztaDoby, "sobota");
  assert.deepEqual(strefy("2025-05-01"), resztaDoby, "1 maja, czwartek");
  assert.deepEqual(strefy("2025-04-21"), resztaDoby, "poniedziałek wielkanocny");
  assert.deepEqual(strefy("2025-06-19"), resztaDoby, "Boże Ciało");
  assert.deepEqual(strefy("2025-11-11"), resztaDoby, "11 listopada, wtorek");
  assert.deepEqual(strefy("2025-12-24"), resztaDoby, "Wigilia, wolna od 2025 r.");
  assert.deepEqual(strefy("2024-12-24"), doba([7, 13], [16, 21]), "Wigilia 2024 r. była dniem roboczym");
  assert.deepEqual(strefy("2025-04-16", "G11"), resztaDoby);
});

test("zmiana taryfy z G13 na G11 od wskazanego dnia", () => {
  const w = seria(
    wiersze(generuj({ od: "2025-04-15", do: "2025-04-16", ziarno: 1, zmianaTaryfy: { od: "2025-04-16", taryfa: "G11" } })),
    SERIA_POBOR,
  );
  assert.ok(w.slice(0, 24).some((p) => p[2] !== "Reszta dnia"));
  assert.ok(w.slice(24).every((p) => p[2] === "Reszta dnia"));
});

test("ta sama godzina ma tę samą wartość w plikach o różnym zakresie", () => {
  const a = wiersze(generuj({ od: "2025-01-01", do: "2025-01-10", ziarno: 5 }));
  const b = wiersze(generuj({ od: "2025-01-08", do: "2025-01-20", ziarno: 5 }));
  const klucz = (p) => `${p[0]}|${p[1]}`;
  const mapaB = new Map(b.map((p) => [klucz(p), p]));
  let wspolne = 0;
  for (const p of a) {
    if (mapaB.has(klucz(p))) {
      assert.deepEqual(p, mapaB.get(klucz(p)));
      wspolne++;
    }
  }
  assert.equal(wspolne, 2 * 3 * 24);
  const innyLos = wiersze(generuj({ od: "2025-01-01", do: "2025-01-10", ziarno: 6 }));
  assert.notDeepEqual(a, innyLos);
});

test("dwa wiersze 03:00 doby 25-godzinnej mają różne wartości poboru", () => {
  const w = seria(wiersze(generuj({ od: "2025-10-26", do: "2025-10-26", ziarno: 3 })), SERIA_POBOR);
  const para = w.filter((p) => p[1] === "2025-10-26 03:00");
  assert.notEqual(para[0][3], para[1][3]);
});

test("obcięcie godzin z początku i z końca", () => {
  const pelny = seria(wiersze(generuj({ od: "2025-10-26", do: "2025-10-27", ziarno: 1 })), SERIA_POBOR);
  const obciety = seria(
    wiersze(generuj({ od: "2025-10-26", do: "2025-10-27", ziarno: 1, obetnijPoczatek: 1, obetnijKoniec: 46 })),
    SERIA_POBOR,
  );
  // 26.10.2025 ma 25 godzin, 27.10.2025 ma 24, razem 49; zostają godziny o indeksach 1 i 2.
  assert.equal(pelny.length, 49);
  assert.deepEqual(obciety, pelny.slice(1, 3));
  // Plik kończy się na pierwszym wierszu 03:00 doby 25-godzinnej.
  assert.equal(obciety.at(-1)[1], "2025-10-26 03:00");
  assert.equal(pelny[3][1], "2025-10-26 03:00", "drugi wiersz 03:00 został obcięty");
});

test("psucie: luka usuwa godziny z obu serii", () => {
  const w = wiersze(generuj({ od: "2025-02-03", do: "2025-02-04", ziarno: 1, luka: { znacznik: "2025-02-03 10:00", godzin: 3 } }));
  for (const nazwa of [SERIA_ODDANIE, SERIA_POBOR]) {
    const s = seria(w, nazwa);
    assert.equal(s.length, 45);
    for (const z of ["2025-02-03 10:00", "2025-02-03 11:00", "2025-02-03 12:00"]) {
      assert.ok(!s.some((p) => p[1] === z));
    }
    assert.ok(s.some((p) => p[1] === "2025-02-03 13:00"));
  }
});

test("psucie: kompletność poniżej 100 w wybranych godzinach obu serii", () => {
  const w = wiersze(generuj({ od: "2025-02-03", do: "2025-02-03", ziarno: 1, niepelne: [{ znacznik: "2025-02-03 05:00", kompletnosc: "87,50" }] }));
  const trafione = w.filter((p) => p[4] !== "100,00");
  assert.equal(trafione.length, 2);
  assert.ok(trafione.every((p) => p[1] === "2025-02-03 05:00" && p[4] === "87,50"));
});

test("psucie: odwrócona para 03:00 zamienia całe wiersze w obu seriach", () => {
  const zwykly = wiersze(generuj({ od: "2025-10-26", do: "2025-10-26", ziarno: 3 }));
  const odwrocony = wiersze(generuj({ od: "2025-10-26", do: "2025-10-26", ziarno: 3, odwrocPare: true }));
  for (const nazwa of [SERIA_ODDANIE, SERIA_POBOR]) {
    const a = seria(zwykly, nazwa);
    const b = seria(odwrocony, nazwa);
    const i = a.findIndex((p) => p[1] === "2025-10-26 03:00");
    assert.deepEqual(b[i], a[i + 1]);
    assert.deepEqual(b[i + 1], a[i]);
    assert.deepEqual([...b.slice(0, i), ...b.slice(i + 2)], [...a.slice(0, i), ...a.slice(i + 2)]);
  }
});

test("psucie: powtórzony wiersz z tą samą albo inną wartością", () => {
  const z = "2025-02-03 05:00";
  const ten = seria(wiersze(generuj({ od: "2025-02-03", do: "2025-02-03", ziarno: 1, powtorz: { znacznik: z, seria: "pobor" } })), SERIA_POBOR);
  const para = ten.filter((p) => p[1] === z);
  assert.equal(ten.length, 25);
  assert.deepEqual(para[0], para[1]);
  const inny = seria(
    wiersze(generuj({ od: "2025-02-03", do: "2025-02-03", ziarno: 1, powtorz: { znacznik: z, seria: "pobor", wartoscWh: 1 } })),
    SERIA_POBOR,
  ).filter((p) => p[1] === z);
  assert.equal(inny[1][3], "0,001");
});

test("psucie: drugi PPE od połowy pliku i PPE w kolumnie Strefa", () => {
  const dwa = dekodujIso(generuj({ od: "2025-02-03", do: "2025-02-03", ziarno: 1, drugiPpe: true }).surowy)
    .slice(0, -2)
    .split("\r\n")
    .slice(1)
    .map((l) => l.split(";")[1]);
  assert.deepEqual(dwa, [...Array(24).fill(`PPE:${PPE_FIKCYJNE[0]}`), ...Array(24).fill(`PPE:${PPE_FIKCYJNE[1]}`)]);

  const wStrefie = wiersze(generuj({ od: "2025-02-03", do: "2025-02-03", ziarno: 1, ppeWStrefie: { znacznik: "2025-02-03 05:00", seria: "pobor" } }));
  const trafione = wStrefie.filter((p) => p[2] === `PPE:${PPE_FIKCYJNE[0]}`);
  assert.equal(trafione.length, 1);
  assert.deepEqual(trafione[0].slice(0, 2), [SERIA_POBOR, "2025-02-03 05:00"]);
});

test("psucie: podmiana dowolnego pola wiersza", () => {
  const w = wiersze(generuj({
    od: "2025-02-03", do: "2025-02-03", ziarno: 1,
    podmien: [{ znacznik: "2025-02-03 07:00", seria: "oddanie", pole: "wartosc", tekst: "1.5" }],
  }));
  const p = seria(w, SERIA_ODDANIE).find((x) => x[1] === "2025-02-03 07:00");
  assert.equal(p[3], "1.5");
});

test("energia bierna: dwie serie pod nazwami z eLicznika, bloki w kolejności alfabetycznej nazw", () => {
  assert.deepEqual(SERIE_BIERNE, ["energia bierna indukcyjna pobrana", "energia bierna pojemnościowa pobrana"]);
  const w = wiersze(generuj({ od: "2025-02-03", do: "2025-02-03", ziarno: 1, bierna: true }));
  assert.equal(w.length, 96);
  const kolejnosc = [...new Set(w.map((p) => p[0]))];
  assert.deepEqual(kolejnosc, [...SERIE_BIERNE, SERIA_ODDANIE, SERIA_POBOR]);
  assert.deepEqual(kolejnosc, [...kolejnosc].sort());
});

test("plik surowy w UTF-8, z BOM i z LF", () => {
  const cp = dekodujIso(generuj(PARAMETRY_N1).surowy);
  const utf8 = generuj({ ...PARAMETRY_N1, kodowanie: "utf-8" }).surowy;
  assert.equal(dekodujUtf8(utf8), cp);
  const bom = generuj({ ...PARAMETRY_N1, kodowanie: "utf-8-bom" }).surowy;
  assert.deepEqual([...bom.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.deepEqual(bom.slice(3), utf8);
  const lf = dekodujUtf8(generuj({ ...PARAMETRY_N1, kodowanie: "utf-8", koniecLinii: "\n" }).surowy);
  assert.equal(lf, cp.replaceAll("\r\n", "\n"));
});

test("nazwy kolumn i serii w psuciu tylko spośród własnych kluczy", () => {
  const dzien = { od: "2025-02-03", do: "2025-02-03", ziarno: 1 };
  for (const pole of ["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"]) {
    assert.throws(() => generuj({ ...dzien, podmien: [{ znacznik: "2025-02-03 05:00", seria: "pobor", pole, tekst: "x" }] }), /nieznane pole/, pole);
    assert.throws(() => generuj({ ...dzien, podmien: [{ znacznik: "2025-02-03 05:00", seria: pole, pole: "strefa", tekst: "x" }] }), /nieznana seria/, pole);
  }
});

test("pusta kolumna płatnika albo PPE", () => {
  const pola = (opcje) => dekodujIso(generuj({ od: "2025-02-03", do: "2025-02-03", ziarno: 1, ...opcje }).surowy).split("\r\n")[1].split(";");
  assert.deepEqual(pola({ ppe: "" }).slice(0, 2), [PLATNICY_FIKCYJNI[0], ""]);
  assert.deepEqual(pola({ platnik: "" }).slice(0, 2), ["", `PPE:${PPE_FIKCYJNE[0]}`]);
});

test("złe parametry: odwrotny zakres, nieznana taryfa, zła data", () => {
  assert.throws(() => generuj({ od: "2025-02-04", do: "2025-02-03" }));
  assert.throws(() => generuj({ od: "2025-02-03", do: "2025-02-03", taryfa: "G12" }));
  assert.throws(() => generuj({ od: "2025-02-30", do: "2025-03-01" }));
});

test("wiersz poleceń zapisuje ten sam plik co funkcja", () => {
  const katalog = mkdtempSync(join(tmpdir(), "generator-"));
  try {
    const plik = join(katalog, "wynik.csv");
    execFileSync(process.execPath, [
      join(KORZEN, "narzedzia", "generator.mjs"),
      "--od", "2025-06-06", "--do", "2025-06-07", "--taryfa", "G13", "--ziarno", "1",
      "--wyjscie", plik,
    ]);
    assert.deepEqual(readFileSync(plik), Buffer.from(generuj(PARAMETRY_N1).surowy));
    const pomoc = execFileSync(process.execPath, [join(KORZEN, "narzedzia", "generator.mjs"), "--help"], { encoding: "utf8" });
    assert.match(pomoc, /--od/);
  } finally {
    rmSync(katalog, { recursive: true, force: true });
  }
});
