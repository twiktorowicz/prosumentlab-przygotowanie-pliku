// Składanie zgłoszenia i ZIP: N20, N25 oraz pełna ścieżka od bajtów plików do ZIP-a.
// Wszystkie wartości z faktury są zmyślone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { przygotujZgloszenie, przygotujPliki, zlozZgloszenie, utworzZipZgloszenia, odnosnikMailto, nazwaZip, WERSJA } from "../app/lib/zgloszenie.js";
import { createHash } from "node:crypto";
import { tekst } from "../app/lib/odmiana.js";
import { TEKSTY } from "../app/teksty.js";
import { czytajZip } from "./pomoc/czytnik-zip.mjs";
import { przykladN20 } from "./pomoc/przyklad-n20.mjs";
import { generuj, PPE_FIKCYJNE, PLATNICY_FIKCYJNI } from "../narzedzia/generator.mjs";

const SCIEZKA_N20 = fileURLToPath(new URL("wzorce/n20.zip", import.meta.url));
const WZORZEC_N1 = readFileSync(fileURLToPath(new URL("wzorce/n1_wyjscie.csv", import.meta.url)));
const N1 = { od: "2025-06-06", do: "2025-06-07", taryfa: "G13", ziarno: 1 };
const NUMER = "K7M3-Q9TX";
const DATA = "2026-11-19";

const tekstPliku = (wpis) => new TextDecoder("utf-8", { fatal: true }).decode(wpis.bajty);
const jsonPliku = (wynik, nazwa) => JSON.parse(tekstPliku(wynik.zawartosc.find((p) => p.nazwa === nazwa)));

const FAKTURA = {
  sprzedawca: "tauron_sprzedaz",
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
const INSTALACJA = { moc_pv_kwp: "7,2", magazyn: "nie" };

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
      "&body=Pami%C4%99taj%20o%20za%C5%82%C4%85czniku%3A%20plik%20prosumentlab_K7M3-Q9TX.zip.%20Bez%20niego%20nie%20przygotujemy%20raportu.",
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
    format: "prosumentlab/instalacja", wersja_formatu: 1, moc_pv_kwp: "7.20", magazyn: "nie",
  });
  const faktury = JSON.parse(tekstPliku(pliki[1]));
  assert.equal(faktury.raport.operator_dystrybucyjny, "tauron_dystrybucja", "operator z trybu Taurona");
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
  const w = przygotujZgloszenie({ pliki: [generuj(N1).bezNumerow], formularz: {}, numer: NUMER, utworzono: DATA });
  assert.equal(w.moznaZapisac, true);
  assert.deepEqual(w.zawartosc.map((p) => p.nazwa), ["zgloszenie.json", "pomiary_1.csv"]);
  const z = jsonPliku(w, "zgloszenie.json");
  assert.equal(z.ppe_porownane, false);
  assert.equal("usuniete_kolumny" in z.pliki[0], false);
  assert.equal(z.pliki[0].wariant_wejscia, "bez_numerow");
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

test("uwagi: kompletność w pliku, faktura poza zakresem, zmiana poza zakresem", () => {
  const w = przygotujZgloszenie({
    pliki: [generuj({ ...N1, niepelne: [{ znacznik: "2025-06-06 05:00" }] }).surowy],
    formularz: {
      faktura: { ...FAKTURA, okres_od: "2025-06-01", okres_do: "2025-06-07" },
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
    { kod: "INSTALACJA_MIESIAC_POZA_ZAKRESEM", gdzie: "instalacja.zmiany[1]" },
  ]);
  assert.deepEqual(jsonPliku(w, "zgloszenie.json").uwagi, w.uwagi.map(({ kod, gdzie }) => ({ kod, gdzie })));
  assert.equal(w.pliki[0].stan, "uwaga");
});

test("system opustów: faktury.json tylko z operatorem i systemem, uwaga FAKTURA_OPUSTY, bez braków", () => {
  const w = przygotujZgloszenie({
    pliki: [generuj(N1).surowy],
    formularz: { faktura: { ...FAKTURA, okres_od: "2025-06-01", oplata_mocowa_zl_mies: "12,345", system_rozliczenia: "opusty" } },
    numer: NUMER,
    utworzono: DATA,
  });
  assert.equal(w.moznaZapisac, true);
  assert.deepEqual(w.bledyPol, []);
  assert.deepEqual(jsonPliku(w, "faktury.json").raport, { operator_dystrybucyjny: "tauron_dystrybucja", system_rozliczenia: "opusty" });
  assert.deepEqual(jsonPliku(w, "zgloszenie.json").uwagi, [{ kod: "ZAKRES_NIEPELNY", gdzie: "zakres" }, { kod: "FAKTURA_OPUSTY", gdzie: "raport" }]);
});

test("uwagi o nietypowej cenie i długim okresie trafiają do zgloszenie.json i nie blokują zapisu", () => {
  const w = przygotujZgloszenie({
    pliki: [generuj(N1).surowy],
    formularz: { faktura: { ...FAKTURA, okres_od: "2025-04-01", okres_do: "2025-06-07", rodzaj_ceny: "dynamiczna", cena_energii_netto_zl_kwh: "2,10" } },
    numer: NUMER,
    utworzono: DATA,
  });
  assert.equal(w.moznaZapisac, true);
  assert.deepEqual(jsonPliku(w, "zgloszenie.json").uwagi, [
    { kod: "ZAKRES_NIEPELNY", gdzie: "zakres" },
    { kod: "FAKTURA_R_POZA_ZAKRESEM", gdzie: "raport" },
    { kod: "FAKTURA_OKRES_DLUGI", gdzie: "raport" },
    { kod: "FAKTURA_CENA_NIETYPOWA", gdzie: "raport" },
  ]);
});

test("okres z przyszłości względem dnia utworzenia: błąd pola, zapis zablokowany", () => {
  const w = przygotujZgloszenie({
    pliki: [generuj(N1).surowy],
    formularz: { faktura: { ...FAKTURA, okres_od: "2026-11-01", okres_do: "2026-11-20" } },
    numer: NUMER,
    utworzono: DATA,
  });
  assert.deepEqual(w.bledyPol, [{ pole: "okres_do", kod: "faktura_okres_przyszly" }]);
  assert.equal(w.powod, "bledy_pol");
  assert.equal(w.zip, null);
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
// Przeliczony po usunięciu pytania o pierwsze oddanie energii (instalacja.json bez tego klucza)
// i po zmianie wersji narzędzia na 0.1.5 (pole narzedzie w zgloszenie.json; reszta ZIP-a bez zmian,
// sprawdzone na kodzie 0.1.4 z samą zmienioną wersją).
const SKROT_SCENARIUSZA = "a516d84f700a7214775da535ef3590ec501a78f5f25fa34635dee0ac73639024";
function scenariuszPelny() {
  return {
    pliki: [
      generuj({ od: "2025-02-20", do: "2025-03-31", ziarno: 8 }).surowy,
      generuj({ od: "2025-01-01", do: "2025-02-21", ziarno: 8 }).surowy,
      generuj({ od: "2025-03-25", do: "2025-04-10", ziarno: 8 }).bezNumerow,
    ],
    formularz: {
      faktura: {
        sprzedawca: "tauron_sprzedaz", taryfa: "g13", okres_od: "2025-03-01", okres_do: "2025-03-31",
        rodzaj_faktury: "rozliczeniowa", system_rozliczenia: "net_billing_rce", rodzaj_ceny: "stala", cena_energii_netto_zl_kwh: ["0,60000", "0,70000", "0,40000"],
        oplata_mocowa_zl_mies: "12,34", oplata_abonamentowa_zl_mies: "5,67", oplata_stala_sieciowa_zl_mies: "8,9", oplata_przejsciowa_zl_mies: "0",
        oplaty_stale_inne: [{ nazwa: "Opłata handlowa", kwota_zl_mies: "9,99" }],
      },
      instalacja: {
        moc_pv_kwp: "7,2", magazyn: "tak", magazyn_pojemnosc_kwh: "10", magazyn_od: "2022-04",
        zmiany: [{ rodzaj: "pompa_ciepla", miesiac: "2025-02" }, { rodzaj: "", miesiac: "" }],
      },
      zgoda: true,
    },
    numer: NUMER,
    utworzono: DATA,
  };
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// Tablic bajtów nie da się zamrozić; to, że złożenie ich nie zmienia, test sprawdza kopią.
function zamroz(o) {
  if (o && typeof o === "object" && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const w of Object.values(o)) zamroz(w);
  }
  return o;
}

test("podział: ZIP złożony z części równy ZIP-owi z całości i zapisanemu skrótowi", () => {
  const dane = scenariuszPelny();
  const zCalosci = przygotujZgloszenie(dane).zip;
  const przygotowane = przygotujPliki(dane.pliki);
  const zCzesci = utworzZipZgloszenia(zlozZgloszenie({ przygotowane, formularz: dane.formularz, numer: NUMER, utworzono: DATA }));
  assert.deepEqual(zCzesci, zCalosci);
  assert.equal(sha256(zCalosci), SKROT_SCENARIUSZA);
});

test("podział: przygotowane pliki składa się wiele razy bez ich zmiany i bez ponownego czytania bajtów", () => {
  const dane = scenariuszPelny();
  const przygotowane = zamroz(przygotujPliki(dane.pliki));
  const kopieCsv = przygotowane.przyjete.map((p) => Buffer.from(p.csv.bajty));
  const a = zlozZgloszenie({ przygotowane, formularz: dane.formularz, numer: NUMER, utworzono: DATA });
  const b = zlozZgloszenie({ przygotowane, formularz: {}, numer: NUMER, utworzono: DATA });
  const c = zlozZgloszenie({ przygotowane, formularz: dane.formularz, numer: NUMER, utworzono: DATA });
  assert.equal(sha256(utworzZipZgloszenia(a)), SKROT_SCENARIUSZA);
  assert.deepEqual(utworzZipZgloszenia(c), utworzZipZgloszenia(a));
  przygotowane.przyjete.forEach((p, i) => assert.deepEqual(Buffer.from(p.csv.bajty), kopieCsv[i], "bajty CSV bez zmian po złożeniu"));
  assert.deepEqual(b.zawartosc.map((p) => p.nazwa), ["zgloszenie.json", "pomiary_1.csv", "pomiary_2.csv", "pomiary_3.csv"]);
  // Przygotowane pliki nie trzymają bajtów wejściowych: zostaje tylko wynik odczytu zakodowany
  // raz w UTF-8. Wynik nie może dzielić bufora z wejściem (ten sam obiekt albo widok na ten sam
  // ArrayBuffer), nawet gdy ma tę samą treść: plik bez numerów w UTF-8 z LF wychodzi bez zmian.
  // Przeglądamy obiekty sami, bo JSON.stringify zamienia Buffer przez toJSON, zanim zobaczy go
  // funkcja zastępująca, a ArrayBuffer zapisuje jako pusty obiekt.
  const wspolne = (v) => dane.pliki.some((wejscie) => v === wejscie || v === wejscie.buffer || (ArrayBuffer.isView(v) && v.buffer === wejscie.buffer));
  const przejdz = (v, sciezka, znalezione) => {
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) znalezione.push({ sciezka, v });
    else if (v && typeof v === "object") for (const [k, w] of Object.entries(v)) przejdz(w, `${sciezka}.${k}`, znalezione);
    return znalezione;
  };
  const bajty = przejdz(przygotowane, "przygotowane", []);
  assert.ok(bajty.length > 0, "zakodowane wyniki CSV są w przygotowanych plikach");
  assert.deepEqual(bajty.filter(({ v }) => wspolne(v)).map(({ sciezka }) => sciezka), []);
  const bezNumerow = przygotowane.przyjete.find((p) => p.odczyt.wariant !== "surowy");
  const wejscieBezNumerow = dane.pliki[bezNumerow.indeks];
  assert.equal(Buffer.compare(Buffer.from(bezNumerow.csv.bajty), Buffer.from(wejscieBezNumerow)), 0, "ta sama treść co wejście");
  assert.notEqual(bezNumerow.csv.bajty.buffer, wejscieBezNumerow.buffer, "ale inny bufor");
  // Sprawdzenie samo musi wykrywać każdą postać wspólnego bufora.
  const wejscie = dane.pliki[0];
  for (const wzor of [wejscie, wejscie.buffer, wejscie.subarray(1, 5), new DataView(wejscie.buffer), Buffer.from(wejscie.buffer)]) {
    assert.equal(przejdz({ pliki: [{ w: wzor }] }, "proba", []).filter(({ v }) => wspolne(v)).length, 1, wzor.constructor.name);
  }
});

test("miesiąc faktury: faktury.json bajt w bajt taki sam jak przy datach pierwszego i ostatniego dnia", () => {
  const dane = scenariuszPelny();
  const przygotowane = przygotujPliki(dane.pliki);
  const zDatami = zlozZgloszenie({ przygotowane, formularz: dane.formularz, numer: NUMER, utworzono: DATA });
  const faktura = { ...dane.formularz.faktura, okres_od: "", okres_do: "", okres_miesiac: "2025-03" };
  const zMiesiacem = zlozZgloszenie({ przygotowane, formularz: { ...dane.formularz, faktura }, numer: NUMER, utworzono: DATA });
  const bajty = (w) => w.zawartosc.find((p) => p.nazwa === "faktury.json").bajty;
  assert.deepEqual(bajty(zMiesiacem), bajty(zDatami));
  assert.equal(sha256(utworzZipZgloszenia(zMiesiacem)), SKROT_SCENARIUSZA);
});

test("ZIP powstaje dopiero przy zapisie: złożenie zgłoszenia nie zwraca archiwum", () => {
  const przygotowane = przygotujPliki([generuj(N1).surowy]);
  const w = zlozZgloszenie({ przygotowane, formularz: { faktura: FAKTURA }, numer: NUMER, utworzono: DATA });
  assert.equal("zip" in w, false);
  assert.equal(w.moznaZapisac, true);
  assert.deepEqual(utworzZipZgloszenia(w), przygotujZgloszenie({ pliki: [generuj(N1).surowy], formularz: { faktura: FAKTURA }, numer: NUMER, utworzono: DATA }).zip);
});

test("utworzZipZgloszenia odmawia, gdy zapis jest niemożliwy: blokada, brak plików, błąd pola", () => {
  const zloz = (pliki, formularz = {}) => zlozZgloszenie({ przygotowane: przygotujPliki(pliki), formularz, numer: NUMER, utworzono: DATA });
  const blokada = zloz([generuj({ ...N1, ppeWStrefie: { znacznik: "2025-06-06 05:00", seria: "pobor" } }).surowy]);
  const brak = zloz([]);
  const pole = zloz([generuj(N1).surowy], { faktura: { oplata_mocowa_zl_mies: "12,345" } });
  for (const [w, powod] of [[blokada, "blokada"], [brak, "brak_plikow"], [pole, "bledy_pol"]]) {
    assert.equal(w.powod, powod);
    assert.throws(() => utworzZipZgloszenia(w), new RegExp(powod), powod);
  }
});

test("bezpiecznik w plikach JSON: słowo PPE w polu wpisanym ręcznie blokuje zapis", () => {
  const przypadki = {
    "nazwa opłaty": { ...FAKTURA, oplaty_stale_inne: [{ nazwa: "Opłata PPE", kwota_zl_mies: "1,00" }] },
    "nazwa taryfy": { ...FAKTURA, taryfa: "inna", taryfa_nazwa: "Taryfa PPE", cena_energii_netto_zl_kwh: "0,50" },
    "nazwa sprzedawcy": { ...FAKTURA, sprzedawca: "inny", sprzedawca_nazwa: "ppe" },
  };
  for (const [nazwa, faktura] of Object.entries(przypadki)) {
    const w = przygotujZgloszenie({ pliki: [generuj(N1).surowy], formularz: { faktura }, numer: NUMER, utworzono: DATA });
    assert.deepEqual(w.bledyPol, [], `${nazwa}: pole przechodzi własną kontrolę`);
    assert.deepEqual(w.blokady, [{ kod: "blad_bezpiecznik_formularz" }], nazwa);
    assert.equal(w.powod, "blokada", nazwa);
    assert.equal(w.zip, null, nazwa);
  }
  // Zwykły formularz i klucz ppe_porownane w zgloszenie.json nie trafiają w reguły.
  const zwykly = przygotujZgloszenie({ pliki: [generuj(N1).surowy], formularz: { faktura: FAKTURA, instalacja: INSTALACJA, zgoda: true }, numer: NUMER, utworzono: DATA });
  assert.deepEqual(zwykly.blokady, []);
});

test("więcej niż jeden przyjęty plik i punkty poboru nieporównane: uwaga bez numerów, JSON bez zmian", () => {
  const surowy = generuj({ od: "2025-01-01", do: "2025-01-10", ziarno: 2 }).surowy;
  const bezNumerow = generuj({ od: "2025-01-11", do: "2025-01-20", ziarno: 2 }).bezNumerow;
  const dwa = przygotujZgloszenie({ pliki: [surowy, bezNumerow], formularz: {}, numer: NUMER, utworzono: DATA });
  assert.equal(dwa.uwagaBezNumerow, true);
  assert.equal(dwa.moznaZapisac, true);
  const z = jsonPliku(dwa, "zgloszenie.json");
  assert.equal(z.ppe_porownane, false);
  assert.equal(z.uwagi.some((u) => /numer/i.test(u.kod)), false, "format JSON bez nowych uwag");
  assert.equal(przygotujZgloszenie({ pliki: [bezNumerow], formularz: {}, numer: NUMER, utworzono: DATA }).uwagaBezNumerow, false, "jeden plik");
  const dwaSurowe = przygotujZgloszenie({ pliki: [surowy, generuj({ od: "2025-01-11", do: "2025-01-20", ziarno: 2 }).surowy], formularz: {}, numer: NUMER, utworzono: DATA });
  assert.equal(dwaSurowe.uwagaBezNumerow, false, "dwa pliki z numerami");
});

test("ten sam plik dwa razy: drugi odrzucony z blad_duplikat, poza ZIP-em i analizą zakresu", () => {
  const plik = generuj(N1).surowy;
  const w = przygotujZgloszenie({ pliki: [plik, plik], formularz: {}, numer: NUMER, utworzono: DATA });
  assert.deepEqual(w.pliki[1], { indeks: 1, stan: "odrzucony", kod: "blad_duplikat" });
  assert.equal(w.pliki[0].stan, "przyjety");
  assert.deepEqual(czytajZip(w.zip).map((p) => p.nazwa), ["zgloszenie.json", "pomiary_1.csv"]);
  assert.equal(jsonPliku(w, "zgloszenie.json").pliki.length, 1);
  // Plik bez numerów o tym samym wyniku co plik surowy wcześniej na liście też jest duplikatem.
  const zBezNumerow = przygotujZgloszenie({ pliki: [plik, generuj(N1).bezNumerow], formularz: {}, numer: NUMER, utworzono: DATA });
  assert.equal(zBezNumerow.pliki[1].kod, "blad_duplikat");
  assert.equal(jsonPliku(zBezNumerow, "zgloszenie.json").ppe_porownane, true, "duplikat nie bierze udziału w porównaniu punktów");
  // Plik z numerami jest duplikatem tylko pliku z tymi samymi numerami: po pliku bez numerów
  // oba są przyjęte (rzadki przypadek bez sprzeczności), a punktów poboru nie da się porównać.
  const odwrotnie = przygotujZgloszenie({ pliki: [generuj(N1).bezNumerow, plik], formularz: {}, numer: NUMER, utworzono: DATA });
  assert.deepEqual(odwrotnie.pliki.map((p) => p.stan), ["przyjety", "przyjety"]);
  assert.equal(jsonPliku(odwrotnie, "zgloszenie.json").ppe_porownane, false);
  assert.equal(odwrotnie.uwagaBezNumerow, true);
  assert.equal(odwrotnie.moznaZapisac, true);
  // Dwa pliki bez numerów z tym samym wynikiem: duplikat.
  const bezNumerow = generuj(N1).bezNumerow;
  assert.equal(przygotujZgloszenie({ pliki: [bezNumerow, bezNumerow], formularz: {}, numer: NUMER, utworzono: DATA }).pliki[1].kod, "blad_duplikat");
});

test("ten sam wynik, inne numery: plik nie znika jako duplikat, różne punkty poboru blokują zapis", () => {
  // To samo ziarno i zakres: wartości, strefy i znaczniki identyczne, różnią się tylko numery.
  const z = (opcje) => generuj({ ...N1, ...opcje }).surowy;
  const pierwszy = z({ ppe: PPE_FIKCYJNE[0], platnik: PLATNICY_FIKCYJNI[0] });
  for (const [opis, drugi] of [
    ["inny PPE i płatnik", z({ ppe: PPE_FIKCYJNE[1], platnik: PLATNICY_FIKCYJNI[1] })],
    ["tylko inny PPE", z({ ppe: PPE_FIKCYJNE[1], platnik: PLATNICY_FIKCYJNI[0] })],
    ["tylko inny płatnik", z({ ppe: PPE_FIKCYJNE[0], platnik: PLATNICY_FIKCYJNI[1] })],
  ]) {
    const w = przygotujZgloszenie({ pliki: [pierwszy, drugi], formularz: {}, numer: NUMER, utworzono: DATA });
    assert.deepEqual(w.pliki.map((p) => p.stan), ["przyjety", "przyjety"], opis);
    assert.equal(w.pliki.some((p) => p.kod === "blad_duplikat"), false, opis);
    assert.deepEqual(w.blokady, [{ kod: "blad_rozne_ppe" }], opis);
    assert.equal(w.moznaZapisac, false, opis);
    assert.equal(w.zip, null, opis);
    assert.equal(jsonPliku(w, "zgloszenie.json").ppe_porownane, true, `${opis}: oba pliki w porównaniu`);
  }
});

test("plik surowy, ten sam bez numerów, ten sam z innym PPE: drugi to duplikat, trzeci blokuje zapis", () => {
  const w = przygotujZgloszenie({
    pliki: [generuj(N1).surowy, generuj(N1).bezNumerow, generuj({ ...N1, ppe: PPE_FIKCYJNE[1], platnik: PLATNICY_FIKCYJNI[1] }).surowy],
    formularz: {}, numer: NUMER, utworzono: DATA,
  });
  assert.equal(w.pliki[0].stan, "przyjety");
  assert.deepEqual(w.pliki[1], { indeks: 1, stan: "odrzucony", kod: "blad_duplikat" });
  assert.equal(w.pliki[2].stan, "przyjety");
  assert.deepEqual(w.blokady, [{ kod: "blad_rozne_ppe" }]);
  assert.equal(w.moznaZapisac, false);
});

test("nieistniejąca godzina 03:00 ostatniej niedzieli marca na początku i na końcu pliku nie wyznacza pierwszej ani ostatniej godziny", () => {
  // Doba 2026-03-29 ma wiersze 01:00, 02:00, 04:00, …; wiersz 03:00 (godzina 2:00–3:00) nie istnieje.
  const naPoczatku = generuj({
    od: "2026-03-29", do: "2026-03-30", ziarno: 3, obetnijPoczatek: 1,
    podmien: ["oddanie", "pobor"].map((seria) => ({ znacznik: "2026-03-29 02:00", seria, pole: "znacznik", tekst: "2026-03-29 03:00" })),
  }).surowy;
  const naKoncu = generuj({
    od: "2026-03-01", do: "2026-03-29", ziarno: 3, obetnijKoniec: 20,
    podmien: ["oddanie", "pobor"].map((seria) => ({ znacznik: "2026-03-29 04:00", seria, pole: "znacznik", tekst: "2026-03-29 03:00" })),
  }).surowy;
  const w = przygotujZgloszenie({ pliki: [naPoczatku, naKoncu], formularz: {}, numer: NUMER, utworzono: DATA });
  assert.deepEqual(w.pliki.map((p) => p.stan), ["przyjety", "przyjety"]);
  const pliki = jsonPliku(w, "zgloszenie.json").pliki;
  // Kolejność w ZIP-ie według pierwszej istniejącej godziny: plik od 1 marca pierwszy.
  assert.deepEqual(pliki.map((p) => [p.pierwszy_znacznik, p.ostatni_znacznik]), [
    ["2026-03-01 01:00", "2026-03-29 02:00"],
    ["2026-03-29 04:00", "2026-03-31 00:00"],
  ]);
  assert.equal(w.pliki[0].pierwszyZnacznik, "2026-03-29 04:00");
  assert.equal(w.pliki[1].ostatniZnacznik, "2026-03-29 02:00");
});

test("wyjątek przy odczycie jednego pliku: ten plik dostaje blad_nieznany, pozostałe działają", () => {
  // Obiekt zamiast bajtów wywraca dekodowanie wyjątkiem (nie ma subarray).
  const zepsuty = { length: 10 };
  const w = przygotujZgloszenie({ pliki: [zepsuty, generuj(N1).surowy], formularz: { faktura: FAKTURA }, numer: NUMER, utworzono: DATA });
  assert.deepEqual(w.pliki[0], { indeks: 0, stan: "odrzucony", kod: "blad_nieznany" });
  assert.equal(w.pliki[1].stan, "przyjety");
  assert.equal(w.moznaZapisac, true);
});
