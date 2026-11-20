// Składanie zgłoszenia i ZIP: N20, N25 oraz pełna ścieżka od bajtów plików do ZIP-a.
// Wszystkie wartości z faktury są zmyślone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { przygotujZgloszenie, przygotujPliki, zlozZgloszenie, odnosnikMailto, nazwaZip, WERSJA } from "../app/lib/zgloszenie.js";
import { createHash } from "node:crypto";
import { tekst } from "../app/lib/odmiana.js";
import { TEKSTY } from "../app/teksty.js";
import { czytajZip } from "./pomoc/czytnik-zip.mjs";
import { przykladN20 } from "./pomoc/przyklad-n20.mjs";
import { generuj, PPE_FIKCYJNE } from "../narzedzia/generator.mjs";

const SCIEZKA_N20 = fileURLToPath(new URL("wzorce/n20.zip", import.meta.url));
const WZORZEC_N1 = readFileSync(fileURLToPath(new URL("wzorce/n1_wyjscie.csv", import.meta.url)));
const N1 = { od: "2025-06-06", do: "2025-06-07", taryfa: "G13", ziarno: 1 };
const NUMER = "K7M3-Q9TX";
const DATA = "2026-11-19";

const tekstPliku = (wpis) => new TextDecoder("utf-8", { fatal: true }).decode(wpis.bajty);
const jsonPliku = (wynik, nazwa) => JSON.parse(tekstPliku(wynik.zawartosc.find((p) => p.nazwa === nazwa)));

const FAKTURA = {
  sprzedawca: "tauron_sprzedaz",
  operator_dystrybucyjny: "tauron_dystrybucja",
  taryfa: "g13",
  okres_od: "2025-06-06",
  okres_do: "2025-06-07",
  rodzaj_faktury: "rozliczeniowa",
  system_rozliczenia: "net_billing_rce",
  rodzaj_ceny: "stala",
  cena_energii_netto_zl_kwh: ["0,60000", "0,70000", "0,40000"],
  oplata_mocowa_zl_mies: "12,34",
  oplata_abonamentowa_zl_mies: "5,67",
  oplata_stala_sieciowa_zl_mies: "8,90",
  oplaty_stale_inne: [{ nazwa: "Opłata handlowa", kwota_zl_mies: "9,99" }],
};
const INSTALACJA = { moc_pv_kwp: "7,2", magazyn: "nie", pierwsze_oddanie: "od_2024_07_01" };

test("N20: ZIP o strukturze z przykładów, numer i data podane: bajty równe wzorcowi", () => {
  const zip = przykladN20();
  assert.deepEqual(Buffer.from(zip), readFileSync(SCIEZKA_N20));
  const pliki = czytajZip(zip);
  assert.deepEqual(pliki.map((p) => p.nazwa), ["zgloszenie.json", "faktury.json", "pomiary_1.csv"]);
  assert.deepEqual(Buffer.from(pliki[2].bajty), WZORZEC_N1);
  assert.equal(JSON.parse(tekstPliku(pliki[0])).numer, NUMER);
  assert.equal(JSON.parse(tekstPliku(pliki[1])).raport.cena_energii_netto_zl_kwh, "0.51234");
});

test("N20: zewnętrzny program unzip potwierdza poprawność, jeśli jest w systemie", (t) => {
  let jest = true;
  try {
    execFileSync("unzip", ["-v"], { stdio: "ignore" });
  } catch {
    jest = false;
  }
  if (!jest) return t.skip("brak programu unzip");
  const wynik = execFileSync("unzip", ["-t", SCIEZKA_N20], { encoding: "utf8" });
  assert.match(wynik, /No errors detected/);
});

test("N25: odnośnik mailto dla numeru K7M3-Q9TX", () => {
  const temat = tekst(TEKSTY, "mailto_temat", { numer: NUMER });
  const tresc = tekst(TEKSTY, "mailto_tresc", { plik: nazwaZip(NUMER) });
  assert.equal(
    odnosnikMailto(temat, tresc),
    "mailto:raporty@prosumentlab.pl" +
      "?subject=Dane%20do%20darmowego%20raportu%2C%20zg%C5%82oszenie%20K7M3-Q9TX" +
      "&body=Za%C5%82%C4%85czam%20plik%20prosumentlab_K7M3-Q9TX.zip.",
  );
});

test("pełna ścieżka: plik surowy, faktura, instalacja i zgoda dają ZIP z czterema plikami", () => {
  const w = przygotujZgloszenie({
    pliki: [generuj(N1).surowy],
    formularz: { faktura: FAKTURA, instalacja: INSTALACJA, zgoda: true },
    numer: NUMER,
    utworzono: DATA,
  });
  assert.equal(w.moznaZapisac, true);
  assert.equal(w.nazwaZip, "prosumentlab_K7M3-Q9TX.zip");
  const pliki = czytajZip(w.zip);
  assert.deepEqual(pliki.map((p) => p.nazwa), ["zgloszenie.json", "faktury.json", "instalacja.json", "pomiary_1.csv"]);
  assert.deepEqual(Buffer.from(pliki[3].bajty), WZORZEC_N1);
  assert.deepEqual(JSON.parse(tekstPliku(pliki[0])), {
    format: "prosumentlab/zgloszenie",
    wersja_formatu: 1,
    narzedzie: WERSJA,
    numer: NUMER,
    utworzono: DATA,
    zgoda_przypadek_testowy: true,
    tryb: "tauron",
    ppe_porownane: true,
    pliki: [{
      nazwa: "pomiary_1.csv",
      wariant_wejscia: "surowy",
      kodowanie_wejscia: "iso-8859-2",
      wiersze_danych: 96,
      pierwszy_znacznik: "2025-06-06 01:00",
      ostatni_znacznik: "2025-06-08 00:00",
      usuniete_kolumny: ["Nr platnika", "Nr punktu poboru energii"],
    }],
    zakres: { pelne_miesiace: 0, ciag_miesiace: 0, klasyfikacja: "za_krotki" },
    uwagi: [{ kod: "ZAKRES_NIEPELNY", gdzie: "zakres" }],
  });
  assert.deepEqual(JSON.parse(tekstPliku(pliki[2])), {
    format: "prosumentlab/instalacja", wersja_formatu: 1, moc_pv_kwp: "7.20", magazyn: "nie", pierwsze_oddanie: "od_2024_07_01",
  });
  const faktury = JSON.parse(tekstPliku(pliki[1]));
  assert.deepEqual(faktury.raport.cena_energii_netto_zl_kwh, ["0.60000", "0.70000", "0.40000"]);
  assert.deepEqual(Object.keys(faktury), ["format", "wersja_formatu", "raport"]);
});

test("w ZIP-ie nie ma numerów płatnika ani PPE, także w nazwach plików", () => {
  const w = przygotujZgloszenie({ pliki: [generuj(N1).surowy], formularz: { faktura: FAKTURA }, numer: NUMER, utworzono: DATA });
  const tekst = new TextDecoder("latin1").decode(w.zip);
  for (const zakazany of [PPE_FIKCYJNE[0], "10000001"]) assert.equal(tekst.includes(zakazany), false);
});

test("te same dane, numer i data dają ten sam ZIP; inny numer daje inny", () => {
  const dane = () => ({ pliki: [generuj(N1).surowy], formularz: { faktura: FAKTURA, zgoda: false }, numer: NUMER, utworzono: DATA });
  assert.deepEqual(przygotujZgloszenie(dane()).zip, przygotujZgloszenie(dane()).zip);
  assert.notDeepEqual(przygotujZgloszenie(dane()).zip, przygotujZgloszenie({ ...dane(), numer: "0000-0000" }).zip);
});

test("bez pól z faktury i bez odpowiedzi: tylko zgloszenie.json i pomiary", () => {
  const w = przygotujZgloszenie({ pliki: [generuj(N1).zanonimizowany], formularz: {}, numer: NUMER, utworzono: DATA });
  assert.equal(w.moznaZapisac, true);
  assert.deepEqual(w.zawartosc.map((p) => p.nazwa), ["zgloszenie.json", "pomiary_1.csv"]);
  const z = jsonPliku(w, "zgloszenie.json");
  assert.equal(z.ppe_porownane, false);
  assert.equal("usuniete_kolumny" in z.pliki[0], false);
  assert.equal(z.pliki[0].wariant_wejscia, "zanonimizowany");
  assert.deepEqual(z.uwagi, [{ kod: "ZAKRES_NIEPELNY", gdzie: "zakres" }, { kod: "FAKTURA_BRAK_OBOWIAZKOWYCH", gdzie: "raport" }]);
});

test("pliki w ZIP-ie w kolejności pierwszej godziny, nie wyboru", () => {
  const pozny = generuj({ od: "2025-03-01", do: "2025-03-31", ziarno: 2 }).surowy;
  const wczesny = generuj({ od: "2025-01-01", do: "2025-02-28", ziarno: 2 }).surowy;
  const w = przygotujZgloszenie({ pliki: [pozny, wczesny], formularz: {}, numer: NUMER, utworzono: DATA });
  const z = jsonPliku(w, "zgloszenie.json");
  assert.deepEqual(z.pliki.map((p) => p.pierwszy_znacznik), ["2025-01-01 01:00", "2025-03-01 01:00"]);
  assert.deepEqual(w.pliki.map((p) => p.nazwa), ["pomiary_2.csv", "pomiary_1.csv"]);
  assert.deepEqual(z.zakres, { pelne_miesiace: 3, ciag_od: "2025-01", ciag_do: "2025-03", ciag_miesiace: 3, klasyfikacja: "za_krotki" });
});

test("plik nieczytelny nie blokuje, tylko nie trafia do zgłoszenia", () => {
  const arkusz = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  const w = przygotujZgloszenie({ pliki: [arkusz, generuj(N1).surowy], formularz: {}, numer: NUMER, utworzono: DATA });
  assert.equal(w.moznaZapisac, true);
  assert.deepEqual(w.pliki[0], { indeks: 0, stan: "odrzucony", kod: "blad_arkusz" });
  assert.equal(w.pliki[1].stan, "przyjety");
  assert.deepEqual(w.zawartosc.map((p) => p.nazwa), ["zgloszenie.json", "pomiary_1.csv"]);
});

test("blokady: bezpiecznik, różne punkty poboru, błąd pola, brak plików", () => {
  const bezpiecznik = przygotujZgloszenie({
    pliki: [generuj({ ...N1, ppeWStrefie: { znacznik: "2025-06-06 05:00", seria: "pobor" } }).surowy],
    formularz: {}, numer: NUMER, utworzono: DATA,
  });
  assert.equal(bezpiecznik.moznaZapisac, false);
  assert.equal(bezpiecznik.zip, null);
  assert.equal(bezpiecznik.powod, "blokada");
  assert.equal(bezpiecznik.blokady[0].kod, "blad_bezpiecznik");
  assert.equal(bezpiecznik.pliki[0].stan, "blokada");

  const rozne = przygotujZgloszenie({
    pliki: [generuj(N1).surowy, generuj({ od: "2025-06-08", do: "2025-06-09", ppe: PPE_FIKCYJNE[1] }).surowy],
    formularz: {}, numer: NUMER, utworzono: DATA,
  });
  assert.deepEqual(rozne.blokady, [{ kod: "blad_rozne_ppe" }]);
  assert.equal(rozne.moznaZapisac, false);

  const pole = przygotujZgloszenie({ pliki: [generuj(N1).surowy], formularz: { faktura: { oplata_mocowa_zl_mies: "12,345" } }, numer: NUMER, utworzono: DATA });
  assert.equal(pole.powod, "bledy_pol");
  assert.deepEqual(pole.bledyPol, [{ pole: "oplata_mocowa_zl_mies", kod: "faktura_kwota_format" }]);

  const nic = przygotujZgloszenie({ pliki: [], formularz: {}, numer: NUMER, utworzono: DATA });
  assert.equal(nic.powod, "brak_plikow");
});

test("najwyżej 10 plików: jedenasty odrzucony", () => {
  const pliki = Array.from({ length: 11 }, (_, i) => generuj({ od: `2025-01-${String(i + 1).padStart(2, "0")}`, do: `2025-01-${String(i + 1).padStart(2, "0")}`, ziarno: 4 }).surowy);
  const w = przygotujZgloszenie({ pliki, formularz: {}, numer: NUMER, utworzono: DATA });
  assert.deepEqual(w.pliki[10], { indeks: 10, stan: "odrzucony", kod: "blad_za_duzo_plikow" });
  assert.equal(w.zawartosc.filter((p) => p.nazwa.startsWith("pomiary_")).length, 10);
});

test("uwagi: kompletność w pliku, faktura poza zakresem, system opustów, zmiana poza zakresem", () => {
  const w = przygotujZgloszenie({
    pliki: [generuj({ ...N1, niepelne: [{ znacznik: "2025-06-06 05:00" }] }).surowy],
    formularz: {
      faktura: { ...FAKTURA, okres_od: "2025-06-01", okres_do: "2025-06-07", system_rozliczenia: "opusty" },
      instalacja: { zmiany: [{ rodzaj: "pompa_ciepla", miesiac: "2025-06" }, { rodzaj: "rozbudowa_pv", miesiac: "2024-01" }] },
    },
    numer: NUMER,
    utworzono: DATA,
  });
  assert.equal(w.moznaZapisac, true);
  assert.deepEqual(w.uwagi, [
    { kod: "UWAGA_KOMPLETNOSC", n: 1, gdzie: "pliki[0]" },
    { kod: "ZAKRES_NIEPELNY", od: { rok: 2025, miesiac: 6, dzien: 6 }, do: { rok: 2025, miesiac: 6, dzien: 7 }, gdzie: "zakres" },
    { kod: "FAKTURA_R_POZA_ZAKRESEM", gdzie: "raport" },
    { kod: "FAKTURA_OPUSTY", gdzie: "raport" },
    { kod: "INSTALACJA_MIESIAC_POZA_ZAKRESEM", gdzie: "instalacja.zmiany[1]" },
  ]);
  assert.deepEqual(jsonPliku(w, "zgloszenie.json").uwagi, w.uwagi.map(({ kod, gdzie }) => ({ kod, gdzie })));
  assert.equal(w.pliki[0].stan, "uwaga");
});

test("plik z samą nieistniejącą godziną 03:00 z doby zmiany czasu na letni: zakres za krótki, bez wyjątku", () => {
  const z = "2025-03-30 01:00";
  const plik = generuj({
    od: "2025-03-30", do: "2025-03-30", ziarno: 1, obetnijKoniec: 22,
    podmien: [
      { znacznik: z, seria: "oddanie", pole: "znacznik", tekst: "2025-03-30 03:00" },
      { znacznik: z, seria: "pobor", pole: "znacznik", tekst: "2025-03-30 03:00" },
    ],
  }).surowy;
  const w = przygotujZgloszenie({
    pliki: [plik],
    formularz: { instalacja: { zmiany: [{ rodzaj: "pompa_ciepla", miesiac: "2025-03" }] } },
    numer: NUMER,
    utworzono: DATA,
  });
  assert.equal(w.pliki[0].stan, "przyjety");
  assert.deepEqual(w.zakres, { pelne_miesiace: 0, ciag_miesiace: 0, klasyfikacja: "za_krotki" });
  assert.equal(w.uwagi.some((u) => u.kod === "INSTALACJA_MIESIAC_POZA_ZAKRESEM"), false);
  assert.equal(w.moznaZapisac, true);
});

test("faktura w zakresie plików: bez uwagi", () => {
  const w = przygotujZgloszenie({ pliki: [generuj(N1).surowy], formularz: { faktura: FAKTURA }, numer: NUMER, utworzono: DATA });
  assert.equal(w.uwagi.some((u) => u.kod === "FAKTURA_R_POZA_ZAKRESEM"), false);
});

test("podgląd: pierwsze 5 wierszy danych dokładnie jak w pliku wyjściowym, sumy miesięczne", () => {
  const w = przygotujZgloszenie({ pliki: [generuj(N1).surowy], formularz: {}, numer: NUMER, utworzono: DATA });
  assert.deepEqual(w.pliki[0].pierwszeWiersze, WZORZEC_N1.toString("utf8").split("\n").slice(1, 6));
  assert.equal(w.miesiace.length, 1);
  assert.equal(w.miesiace[0].miesiac, 6);
});

// Scenariusz z trzema plikami (dwa zachodzą na siebie, jeden bez numerów) i pełnym formularzem.
// Przetwarzanie jest podzielone na dwie części: przygotowanie plików (przygotujPliki) i złożenie
// zgłoszenia z formularzem (zlozZgloszenie). ZIP złożony z części ma być bajt w bajt taki sam jak
// ZIP z całości (przygotujZgloszenie). Zapisany skrót to zrzut wyniku obecnego kodu: pilnuje, żeby
// żadna zmiana nie przesunęła ani jednego bajtu bez świadomego przeliczenia skrótu.
const SKROT_SCENARIUSZA = "68fd2700d42972f3e82e95f3820c61985e419cfa812bea709ce6333817d574a6";
function scenariuszPelny() {
  return {
    pliki: [
      generuj({ od: "2025-02-20", do: "2025-03-31", ziarno: 8 }).surowy,
      generuj({ od: "2025-01-01", do: "2025-02-21", ziarno: 8 }).surowy,
      generuj({ od: "2025-03-25", do: "2025-04-10", ziarno: 8 }).zanonimizowany,
    ],
    formularz: {
      faktura: {
        sprzedawca: "tauron_sprzedaz", operator_dystrybucyjny: "tauron_dystrybucja", taryfa: "g13", okres_od: "2025-03-01", okres_do: "2025-03-31",
        rodzaj_faktury: "rozliczeniowa", system_rozliczenia: "net_billing_rce", rodzaj_ceny: "stala", cena_energii_netto_zl_kwh: ["0,60000", "0,70000", "0,40000"],
        oplata_mocowa_zl_mies: "12,34", oplata_abonamentowa_zl_mies: "5,67", oplata_stala_sieciowa_zl_mies: "8,9", oplata_przejsciowa_zl_mies: "0",
        oplaty_stale_inne: [{ nazwa: "Opłata handlowa", kwota_zl_mies: "9,99" }],
      },
      instalacja: {
        moc_pv_kwp: "7,2", magazyn: "tak", magazyn_pojemnosc_kwh: "10", magazyn_od: "2022-04", pierwsze_oddanie: "nie_wiem",
        zmiany: [{ rodzaj: "pompa_ciepla", miesiac: "2025-02" }, { rodzaj: "", miesiac: "" }],
      },
      zgoda: true,
    },
    numer: NUMER,
    utworzono: DATA,
  };
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

function zamroz(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const w of Object.values(o)) zamroz(w);
  }
  return o;
}

test("podział: ZIP złożony z części równy ZIP-owi z całości i zapisanemu skrótowi", () => {
  const dane = scenariuszPelny();
  const zCalosci = przygotujZgloszenie(dane).zip;
  const przygotowane = przygotujPliki(dane.pliki);
  const zCzesci = zlozZgloszenie({ przygotowane, formularz: dane.formularz, numer: NUMER, utworzono: DATA }).zip;
  assert.deepEqual(zCzesci, zCalosci);
  assert.equal(sha256(zCalosci), SKROT_SCENARIUSZA);
});

test("podział: przygotowane pliki składa się wiele razy bez ich zmiany i bez ponownego czytania bajtów", () => {
  const dane = scenariuszPelny();
  const przygotowane = zamroz(przygotujPliki(dane.pliki));
  const a = zlozZgloszenie({ przygotowane, formularz: dane.formularz, numer: NUMER, utworzono: DATA });
  const b = zlozZgloszenie({ przygotowane, formularz: {}, numer: NUMER, utworzono: DATA });
  const c = zlozZgloszenie({ przygotowane, formularz: dane.formularz, numer: NUMER, utworzono: DATA });
  assert.equal(sha256(a.zip), SKROT_SCENARIUSZA);
  assert.deepEqual(c.zip, a.zip);
  assert.deepEqual(b.zawartosc.map((p) => p.nazwa), ["zgloszenie.json", "pomiary_1.csv", "pomiary_2.csv", "pomiary_3.csv"]);
  // W przygotowanych plikach nie zostają bajty wejściowe w żadnej postaci: złożenie korzysta tylko
  // z odczytu. Przeglądamy obiekty sami, bo JSON.stringify zamienia Buffer przez toJSON, zanim
  // zobaczy go funkcja zastępująca, a ArrayBuffer zapisuje jako pusty obiekt.
  const bajty = [];
  const przejdz = (v, sciezka) => {
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) bajty.push(sciezka);
    else if (v && typeof v === "object") for (const [k, w] of Object.entries(v)) przejdz(w, `${sciezka}.${k}`);
  };
  przejdz(przygotowane, "przygotowane");
  assert.deepEqual(bajty, []);
  // Sprawdzenie samo musi wykrywać każdą z tych postaci.
  for (const wzor of [new Uint8Array(1), Buffer.from("x"), new ArrayBuffer(1), new DataView(new ArrayBuffer(1))]) {
    bajty.length = 0;
    przejdz({ pliki: [{ wejscie: wzor }] }, "proba");
    assert.deepEqual(bajty, ["proba.pliki.0.wejscie"], wzor.constructor.name);
  }
});
