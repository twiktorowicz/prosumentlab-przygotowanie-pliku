// Formularz: pola grupy R z faktury i odpowiedzi o instalacji. Wartości zmyślone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { czytajFormularz, OBOWIAZKOWE_R } from "../app/lib/formularz.js";

const FAKTURA = {
  sprzedawca: "tauron_sprzedaz",
  operator_dystrybucyjny: "tauron_dystrybucja",
  taryfa: "g13",
  okres_od: "2025-04-01",
  okres_do: "2025-04-30",
  rodzaj_faktury: "rozliczeniowa",
  system_rozliczenia: "net_billing_rce",
  rodzaj_ceny: "dynamiczna",
  cena_energii_netto_zl_kwh: "0,51234",
  oplata_mocowa_zl_mies: "12,34",
  oplata_abonamentowa_zl_mies: "5,67",
  oplata_stala_sieciowa_zl_mies: "8,9",
};

test("pełna grupa R: wartości odczytane, klucze w kolejności tabeli pól", () => {
  const w = czytajFormularz({ faktura: { ...FAKTURA, oplata_przejsciowa_zl_mies: "0,00", oplaty_stale_inne: [{ nazwa: "Opłata handlowa", kwota_zl_mies: "9,99" }] } });
  assert.deepEqual(w.bledy, []);
  assert.deepEqual(w.brakujace, []);
  assert.deepEqual(Object.entries(w.raport), [
    ["sprzedawca", "tauron_sprzedaz"],
    ["operator_dystrybucyjny", "tauron_dystrybucja"],
    ["taryfa", "g13"],
    ["okres_od", "2025-04-01"],
    ["okres_do", "2025-04-30"],
    ["rodzaj_faktury", "rozliczeniowa"],
    ["system_rozliczenia", "net_billing_rce"],
    ["rodzaj_ceny", "dynamiczna"],
    ["cena_energii_netto_zl_kwh", "0.51234"],
    ["oplata_mocowa_zl_mies", "12.34"],
    ["oplata_abonamentowa_zl_mies", "5.67"],
    ["oplata_stala_sieciowa_zl_mies", "8.90"],
    ["oplata_przejsciowa_zl_mies", "0.00"],
    ["oplaty_stale_inne", [{ nazwa: "Opłata handlowa", kwota_zl_mies: "9.99" }]],
  ]);
});

test("pusty formularz: puste obiekty, lista brakujących pól obowiązkowych, bez błędów", () => {
  const w = czytajFormularz({});
  assert.deepEqual(w.raport, {});
  assert.deepEqual(w.instalacja, {});
  assert.deepEqual(w.bledy, []);
  assert.deepEqual(w.brakujace, OBOWIAZKOWE_R);
  assert.equal(OBOWIAZKOWE_R.length, 12);
  assert.equal(w.zgoda, false);
});

test("pola puste i same spacje nie trafiają do danych", () => {
  const w = czytajFormularz({ faktura: { ...FAKTURA, oplata_mocowa_zl_mies: "  ", oplata_przejsciowa_zl_mies: "" } });
  assert.equal("oplata_mocowa_zl_mies" in w.raport, false);
  assert.equal("oplata_przejsciowa_zl_mies" in w.raport, false);
  assert.deepEqual(w.brakujace, ["oplata_mocowa_zl_mies"]);
});

test("pole w złym formacie: błąd przy polu, pole nie trafia do danych i nie jest liczone jako brakujące", () => {
  const w = czytajFormularz({ faktura: { ...FAKTURA, oplata_mocowa_zl_mies: "12,345", cena_energii_netto_zl_kwh: "0,5" } });
  assert.deepEqual(w.bledy, [
    { pole: "cena_energii_netto_zl_kwh", kod: "faktura_cena_format" },
    { pole: "oplata_mocowa_zl_mies", kod: "faktura_kwota_format" },
  ]);
  assert.equal("oplata_mocowa_zl_mies" in w.raport, false);
  assert.deepEqual(w.brakujace, []);
});

test("okres: koniec przed początkiem to błąd, zła data to błąd", () => {
  const w = czytajFormularz({ faktura: { ...FAKTURA, okres_od: "2025-04-30", okres_do: "2025-04-01" } });
  assert.deepEqual(w.bledy, [{ pole: "okres_do", kod: "faktura_okres" }]);
  assert.equal("okres_do" in w.raport, false);
  const z = czytajFormularz({ faktura: { ...FAKTURA, okres_od: "2025-02-30" } });
  assert.deepEqual(z.bledy, [{ pole: "okres_od", kod: "faktura_data_format" }]);
});

test("cena w strefach: liczba wartości równa liczbie stref taryfy", () => {
  const ok = czytajFormularz({ faktura: { ...FAKTURA, cena_energii_netto_zl_kwh: ["0,60", "0,70", "0,40"] } });
  assert.deepEqual(ok.raport.cena_energii_netto_zl_kwh, ["0.60", "0.70", "0.40"]);
  const za_malo = czytajFormularz({ faktura: { ...FAKTURA, cena_energii_netto_zl_kwh: ["0,60", "0,70"] } });
  assert.deepEqual(za_malo.bledy, [{ pole: "cena_energii_netto_zl_kwh", kod: "faktura_strefy_liczba" }]);
  const luka = czytajFormularz({ faktura: { ...FAKTURA, cena_energii_netto_zl_kwh: ["0,60", "", "0,40"] } });
  assert.deepEqual(luka.bledy, [{ pole: "cena_energii_netto_zl_kwh", kod: "faktura_strefy_liczba" }]);
  const zla = czytajFormularz({ faktura: { ...FAKTURA, cena_energii_netto_zl_kwh: ["0,60", "0,7", "0,40"] } });
  assert.deepEqual(zla.bledy, [{ pole: "cena_energii_netto_zl_kwh[1]", kod: "faktura_cena_format" }]);
  const puste = czytajFormularz({ faktura: { ...FAKTURA, cena_energii_netto_zl_kwh: ["", "", ""] } });
  assert.deepEqual(puste.bledy, []);
  assert.deepEqual(puste.brakujace, ["cena_energii_netto_zl_kwh"]);
  const g12 = czytajFormularz({ faktura: { ...FAKTURA, taryfa: "g12w", cena_energii_netto_zl_kwh: ["0,60", "0,40"] } });
  assert.deepEqual(g12.bledy, []);
  const inna = czytajFormularz({ faktura: { ...FAKTURA, taryfa: "inna", taryfa_nazwa: "Taryfa X", cena_energii_netto_zl_kwh: ["0,1", "0,2", "0,3", "0,4", "0,5"].map((c) => `${c}0`) } });
  assert.deepEqual(inna.bledy, [{ pole: "cena_energii_netto_zl_kwh", kod: "faktura_strefy_liczba" }], "taryfa inna: najwyżej 4 strefy");
  const bezTaryfy = czytajFormularz({ faktura: { ...FAKTURA, taryfa: "", cena_energii_netto_zl_kwh: ["0,60", "0,40"] } });
  assert.deepEqual(bezTaryfy.bledy, [{ pole: "cena_energii_netto_zl_kwh", kod: "faktura_strefy_liczba" }]);
});

test("pola tekstowe tylko przy „inny” i „inna”, obowiązkowe przy nich", () => {
  const inny = czytajFormularz({ faktura: { ...FAKTURA, sprzedawca: "inny", sprzedawca_nazwa: "Sprzedawca Prądu 2025" } });
  assert.deepEqual(Object.keys(inny.raport).slice(0, 3), ["sprzedawca", "sprzedawca_nazwa", "operator_dystrybucyjny"]);
  const bezNazwy = czytajFormularz({ faktura: { ...FAKTURA, sprzedawca: "inny" } });
  assert.deepEqual(bezNazwy.brakujace, ["sprzedawca_nazwa"]);
  const zbedna = czytajFormularz({ faktura: { ...FAKTURA, sprzedawca_nazwa: "Coś", taryfa_nazwa: "Coś" } });
  assert.equal("sprzedawca_nazwa" in zbedna.raport, false);
  assert.equal("taryfa_nazwa" in zbedna.raport, false);
  const zlyTekst = czytajFormularz({ faktura: { ...FAKTURA, taryfa: "inna", taryfa_nazwa: "Taryfa 12345", cena_energii_netto_zl_kwh: "0,50" } });
  assert.deepEqual(zlyTekst.bledy, [{ pole: "taryfa_nazwa", kod: "tekst_wolny_blad" }]);
});

test("opłaty stałe inne: obie części albo żadna", () => {
  const w = czytajFormularz({
    faktura: {
      ...FAKTURA,
      oplaty_stale_inne: [
        { nazwa: "Opłata handlowa", kwota_zl_mies: "9,99" },
        { nazwa: "", kwota_zl_mies: "" },
        { nazwa: "Opłata X", kwota_zl_mies: "" },
        { nazwa: "Nr 123456", kwota_zl_mies: "1,00" },
        { nazwa: "Opłata Y", kwota_zl_mies: "1,001" },
      ],
    },
  });
  assert.deepEqual(w.raport.oplaty_stale_inne, [{ nazwa: "Opłata handlowa", kwota_zl_mies: "9.99" }]);
  assert.deepEqual(w.bledy, [
    { pole: "oplaty_stale_inne[2]", kod: "faktura_oplata_niepelna" },
    { pole: "oplaty_stale_inne[3].nazwa", kod: "tekst_wolny_blad" },
    { pole: "oplaty_stale_inne[4].kwota_zl_mies", kod: "faktura_kwota_format" },
  ]);
  const puste = czytajFormularz({ faktura: { ...FAKTURA, oplaty_stale_inne: [{ nazwa: " ", kwota_zl_mies: "" }] } });
  assert.equal("oplaty_stale_inne" in puste.raport, false);
});

test("wartość spoza listy to błąd wyboru", () => {
  const w = czytajFormularz({ faktura: { ...FAKTURA, taryfa: "g14", rodzaj_faktury: "prognozowa" } });
  assert.deepEqual(w.bledy, [
    { pole: "taryfa", kod: "blad_wyboru" },
    { pole: "rodzaj_faktury", kod: "blad_wyboru" },
  ]);
});

test("instalacja: wszystkie pola, kolejność kluczy, normalizacja liczb", () => {
  const w = czytajFormularz({
    instalacja: {
      moc_pv_kwp: "7,2",
      magazyn: "tak",
      magazyn_pojemnosc_kwh: "10",
      magazyn_od: "2022-04",
      pierwsze_oddanie: "nie_wiem",
      zmiany: [{ rodzaj: "pompa_ciepla", miesiac: "2024-11" }],
    },
  });
  assert.deepEqual(w.bledy, []);
  assert.deepEqual(Object.entries(w.instalacja), [
    ["moc_pv_kwp", "7.20"],
    ["magazyn", "tak"],
    ["magazyn_pojemnosc_kwh", "10.00"],
    ["magazyn_od", "2022-04"],
    ["pierwsze_oddanie", "nie_wiem"],
    ["zmiany", [{ rodzaj: "pompa_ciepla", miesiac: "2024-11" }]],
  ]);
});

test("instalacja: niepełny wybór miesiąca i roku magazynu to błąd instalacja_miesiac_niepelny", () => {
  for (const niepelny of ["2022-", "-04"]) {
    const w = czytajFormularz({ instalacja: { magazyn: "tak", magazyn_od: niepelny } });
    assert.deepEqual(w.bledy, [{ pole: "magazyn_od", kod: "instalacja_miesiac_niepelny" }], niepelny);
    assert.equal("magazyn_od" in w.instalacja, false);
  }
});

test("instalacja: dane magazynu tylko przy „tak”", () => {
  const w = czytajFormularz({ instalacja: { magazyn: "nie", magazyn_pojemnosc_kwh: "10", magazyn_od: "2022-04" } });
  assert.deepEqual(w.instalacja, { magazyn: "nie" });
});

test("instalacja: błędy liczb, miesięcy i zmian", () => {
  const w = czytajFormularz({
    instalacja: {
      moc_pv_kwp: "0",
      magazyn: "tak",
      magazyn_pojemnosc_kwh: "10,555",
      magazyn_od: "2022-13",
      zmiany: [
        { rodzaj: "samochod_elektryczny", miesiac: "" },
        { rodzaj: "pompa_ciepla", miesiac: "2025-1" },
        { rodzaj: "pompa_ciepla", miesiac: "2025-02" },
        { rodzaj: "pompa_ciepla", miesiac: "2025-03" },
      ],
    },
  });
  assert.deepEqual(w.bledy, [
    { pole: "moc_pv_kwp", kod: "instalacja_liczba_format" },
    { pole: "magazyn_pojemnosc_kwh", kod: "instalacja_liczba_format" },
    { pole: "magazyn_od", kod: "instalacja_miesiac_format" },
    { pole: "zmiany[0]", kod: "instalacja_miesiac_brak" },
    { pole: "zmiany[1]", kod: "instalacja_miesiac_format" },
    { pole: "zmiany[3]", kod: "blad_wyboru" },
  ]);
  assert.deepEqual(w.instalacja, { magazyn: "tak", zmiany: [{ rodzaj: "pompa_ciepla", miesiac: "2025-02" }] });
});

test("zgoda tylko jako wartość logiczna true", () => {
  assert.equal(czytajFormularz({ zgoda: true }).zgoda, true);
  assert.equal(czytajFormularz({ zgoda: "true" }).zgoda, false);
});
