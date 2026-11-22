// Formularz: pola grupy R z faktury i odpowiedzi o instalacji. Wartości zmyślone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { czytajFormularz as czytajFormularzZOpcjami, OBOWIAZKOWE_R, bladBudowyFormularza, okresMiesiaca, sprzedawcaZListy } from "../app/lib/formularz.js";

// Strona i wiersz poleceń podają operatora z trybu (Tauron) i dzień z zegara urządzenia.
const OPCJE = { operator: "tauron_dystrybucja", dzisiaj: "2026-11-20" };
const czytajFormularz = (dane, opcje = {}) => czytajFormularzZOpcjami(dane, { ...OPCJE, ...opcje });

const FAKTURA = {
  sprzedawca: "tauron_sprzedaz",
  taryfa: "g13",
  okres_od: "2025-04-01",
  okres_do: "2025-04-30",
  rodzaj_faktury: "rozliczeniowa",
  system_rozliczenia: "net_billing_rce",
  rodzaj_ceny: "stala",
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
    ["rodzaj_ceny", "stala"],
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
  assert.deepEqual(OBOWIAZKOWE_R, [
    "system_rozliczenia", "sprzedawca", "okres_od", "okres_do", "rodzaj_ceny", "taryfa", "cena_energii_netto_zl_kwh",
  ], "w kolejności pytań na ekranie");
  assert.deepEqual(w.uwagi, []);
  assert.equal(w.zgoda, false);
});

test("pola puste i same spacje nie trafiają do danych", () => {
  const w = czytajFormularz({ faktura: { ...FAKTURA, oplata_mocowa_zl_mies: "  ", oplata_przejsciowa_zl_mies: "" } });
  assert.equal("oplata_mocowa_zl_mies" in w.raport, false);
  assert.equal("oplata_przejsciowa_zl_mies" in w.raport, false);
  assert.deepEqual(w.brakujace, [], "opłaty stałe są nieobowiązkowe");
});

test("pole w złym formacie: błąd przy polu, pole nie trafia do danych i nie jest liczone jako brakujące", () => {
  const w = czytajFormularz({ faktura: { ...FAKTURA, oplata_mocowa_zl_mies: "12,345", cena_energii_netto_zl_kwh: "0,1234567" } });
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
  const zla = czytajFormularz({ faktura: { ...FAKTURA, cena_energii_netto_zl_kwh: ["0,60", "0,7x", "0,40"] } });
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

test("G12, G12w i G13 z jedną ceną jako tekstem: przyjęte bez błędu (starsze pliki formularza)", () => {
  for (const taryfa of ["g12", "g12w", "g13"]) {
    const w = czytajFormularz({ faktura: { ...FAKTURA, taryfa, cena_energii_netto_zl_kwh: "0,60" } });
    assert.deepEqual(w.bledy, [], taryfa);
    assert.equal(w.raport.cena_energii_netto_zl_kwh, "0.60", taryfa);
  }
});

test("taryfa „inna”: puste pola stref na końcu się nie liczą, puste w środku to błąd", () => {
  const inna = (cena) => czytajFormularz({ faktura: { ...FAKTURA, taryfa: "inna", taryfa_nazwa: "Taryfa X", cena_energii_netto_zl_kwh: cena } });
  const dwie = inna(["0,10", "0,20", "", " "]);
  assert.deepEqual(dwie.bledy, []);
  assert.deepEqual(dwie.raport.cena_energii_netto_zl_kwh, ["0.10", "0.20"]);
  assert.deepEqual(inna(["0,10", "", "0,30"]).bledy, [{ pole: "cena_energii_netto_zl_kwh", kod: "faktura_strefy_liczba" }]);
  assert.deepEqual(inna(["", "0,20"]).bledy, [{ pole: "cena_energii_netto_zl_kwh", kod: "faktura_strefy_liczba" }]);
  // Przy taryfie o stałej liczbie stref puste pole na końcu dalej jest błędem.
  const g13 = czytajFormularz({ faktura: { ...FAKTURA, taryfa: "g13", cena_energii_netto_zl_kwh: ["0,60", "0,70", ""] } });
  assert.deepEqual(g13.bledy, [{ pole: "cena_energii_netto_zl_kwh", kod: "faktura_strefy_liczba" }]);
});

test("kwota najwyżej 4 cyfry; cena od 10 zł/kWh to cena w groszach", () => {
  const w = czytajFormularz({ faktura: { ...FAKTURA, oplata_mocowa_zl_mies: "10000", cena_energii_netto_zl_kwh: "100,50" } });
  assert.deepEqual(w.bledy, [
    { pole: "cena_energii_netto_zl_kwh", kod: "faktura_cena_grosze" },
    { pole: "oplata_mocowa_zl_mies", kod: "faktura_kwota_format" },
  ]);
});

test("cena bez dopisywania groszy: zapis z co najmniej dwoma miejscami, od 10 zł błąd faktura_cena_grosze", () => {
  const cena = (c, faktura = {}) => czytajFormularz({ faktura: { ...FAKTURA, ...faktura, cena_energii_netto_zl_kwh: c } });
  assert.equal(cena("1").raport.cena_energii_netto_zl_kwh, "1.00");
  assert.equal(cena("0,6").raport.cena_energii_netto_zl_kwh, "0.60");
  assert.equal(cena("0,51234").raport.cena_energii_netto_zl_kwh, "0.51234");
  assert.deepEqual(cena(["0,6", "1", "0,4"]).raport.cena_energii_netto_zl_kwh, ["0.60", "1.00", "0.40"]);
  assert.equal(cena("0,6", { rodzaj_ceny: "dynamiczna" }).raport.cena_energii_netto_zl_kwh, "0.60");
  const grosze = cena("51");
  assert.deepEqual(grosze.bledy, [{ pole: "cena_energii_netto_zl_kwh", kod: "faktura_cena_grosze" }]);
  assert.equal("cena_energii_netto_zl_kwh" in grosze.raport, false);
  assert.deepEqual(grosze.brakujace, [], "pole z błędem nie jest brakujące");
  assert.deepEqual(grosze.uwagi, [], "błąd zamiast uwagi o nietypowej cenie");
  assert.deepEqual(cena(["0,60", "51", "0,40"]).bledy, [{ pole: "cena_energii_netto_zl_kwh[1]", kod: "faktura_cena_grosze" }]);
  assert.deepEqual(cena("51", { rodzaj_ceny: "dynamiczna" }).bledy, [{ pole: "cena_energii_netto_zl_kwh", kod: "faktura_cena_grosze" }]);
  assert.deepEqual(cena("9,99").bledy, []);
});

test("jeden zakres lat 2010–2099: okres faktury i miesiące w odpowiedziach o instalacji", () => {
  for (const zla of ["2009-12-31", "2100-01-01"]) {
    assert.deepEqual(czytajFormularz({ faktura: { ...FAKTURA, okres_od: zla, okres_do: "" } }).bledy, [{ pole: "okres_od", kod: "faktura_data_format" }], zla);
  }
  // Dzień z zegara na końcu zakresu, żeby koniec okresu nie był datą z przyszłości.
  assert.deepEqual(czytajFormularz({ faktura: { ...FAKTURA, okres_od: "2010-01-01", okres_do: "2099-12-31" } }, { dzisiaj: "2099-12-31" }).bledy, []);
  for (const zly of ["2009-12", "2100-01"]) {
    const w = czytajFormularz({ instalacja: { magazyn: "tak", magazyn_od: zly, zmiany: [{ rodzaj: "pompa_ciepla", miesiac: zly }] } });
    assert.deepEqual(w.bledy, [{ pole: "magazyn_od", kod: "instalacja_miesiac_format" }, { pole: "zmiany[0]", kod: "instalacja_miesiac_format" }], zly);
  }
  const dobre = czytajFormularz({ instalacja: { magazyn: "tak", magazyn_od: "2010-01", zmiany: [{ rodzaj: "pompa_ciepla", miesiac: "2099-12" }] } });
  assert.deepEqual(dobre.bledy, []);
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
      zmiany: [{ rodzaj: "pompa_ciepla", miesiac: "2024-11" }],
    },
  });
  assert.deepEqual(w.bledy, []);
  assert.deepEqual(Object.entries(w.instalacja), [
    ["moc_pv_kwp", "7.20"],
    ["magazyn", "tak"],
    ["magazyn_pojemnosc_kwh", "10.00"],
    ["magazyn_od", "2022-04"],
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

test("instalacja: moc przed rozbudową tylko przy rozbudowie instalacji, format jak moc instalacji", () => {
  const zmiany = (z) => czytajFormularz({ instalacja: { zmiany: z } });
  const z = zmiany([{ rodzaj: "rozbudowa_pv", miesiac: "2025-05", moc_przed_kwp: "3,1" }]);
  assert.deepEqual(z.bledy, []);
  assert.deepEqual(Object.entries(z.instalacja.zmiany[0]), [["rodzaj", "rozbudowa_pv"], ["miesiac", "2025-05"], ["moc_przed_kwp", "3.10"]]);
  // Bez mocy przed (puste pole albo brak klucza) wpis jak dotąd.
  for (const moc of [undefined, "", "  "]) {
    assert.deepEqual(zmiany([{ rodzaj: "rozbudowa_pv", miesiac: "2025-05", moc_przed_kwp: moc }]).instalacja.zmiany, [{ rodzaj: "rozbudowa_pv", miesiac: "2025-05" }], String(moc));
  }
  // Przy innej zmianie moc przed nie ma znaczenia i nie trafia do pliku (pole jest tylko przy rozbudowie).
  const inna = zmiany([{ rodzaj: "pompa_ciepla", miesiac: "2025-05", moc_przed_kwp: "3,1" }]);
  assert.deepEqual(inna.bledy, []);
  assert.deepEqual(inna.instalacja.zmiany, [{ rodzaj: "pompa_ciepla", miesiac: "2025-05" }]);
  // Zły format: błąd pola, wartość nie trafia do danych.
  for (const zla of ["0", "-1", "abc", "1000", "3,123"]) {
    const w = zmiany([{ rodzaj: "rozbudowa_pv", miesiac: "2025-05", moc_przed_kwp: zla }]);
    assert.deepEqual(w.bledy, [{ pole: "moc_przed_kwp", kod: "instalacja_liczba_format" }], zla);
    assert.deepEqual(w.instalacja.zmiany, [{ rodzaj: "rozbudowa_pv", miesiac: "2025-05" }], zla);
  }
  // Plik formularza: klucz moc_przed_kwp jest tekstem.
  assert.equal(bladBudowyFormularza({ instalacja: { zmiany: [{ rodzaj: "rozbudowa_pv", miesiac: "2025-05", moc_przed_kwp: "3,1" }] } }), null);
  assert.equal(bladBudowyFormularza({ instalacja: { zmiany: [{ rodzaj: "rozbudowa_pv", miesiac: "2025-05", moc_przed_kwp: 3.1 }] } }), "instalacja.zmiany[0].moc_przed_kwp");
});

test("instalacja: moc przed rozbudową mniejsza niż obecna moc, gdy obie są podane", () => {
  const czytaj = (moc, przed) => czytajFormularz({ instalacja: { moc_pv_kwp: moc, zmiany: [{ rodzaj: "rozbudowa_pv", miesiac: "2025-05", moc_przed_kwp: przed }] } });
  // Mniejsza: przyjęta.
  for (const [moc, przed] of [["8,4", "3,7"], ["8,4", "8,39"], ["10", "9,99"], ["100", "99"]]) {
    const w = czytaj(moc, przed);
    assert.deepEqual(w.bledy, [], `${moc} / ${przed}`);
    assert.ok("moc_przed_kwp" in w.instalacja.zmiany[0], `${moc} / ${przed}`);
  }
  // Równa albo większa: błąd pola, wartość nie trafia do pliku, wpis zmiany i obecna moc zostają.
  for (const [moc, przed] of [["8,4", "8,4"], ["8,4", "8,40"], ["8,4", "9"], ["9,99", "10"], ["1", "100"]]) {
    const w = czytaj(moc, przed);
    assert.deepEqual(w.bledy, [{ pole: "moc_przed_kwp", kod: "instalacja_moc_przed_za_duza" }], `${moc} / ${przed}`);
    assert.deepEqual(w.instalacja.zmiany, [{ rodzaj: "rozbudowa_pv", miesiac: "2025-05" }], `${moc} / ${przed}`);
    assert.ok("moc_pv_kwp" in w.instalacja, `${moc} / ${przed}`);
  }
  // Bez obecnej mocy albo z obecną mocą w złym formacie nie ma z czym porównać.
  assert.deepEqual(czytaj("", "7").bledy, []);
  assert.deepEqual(czytaj("abc", "7").bledy, [{ pole: "moc_pv_kwp", kod: "instalacja_liczba_format" }]);
  // Zły format mocy przed: tylko błąd formatu, bez porównania.
  assert.deepEqual(czytaj("8,4", "abc").bledy, [{ pole: "moc_przed_kwp", kod: "instalacja_liczba_format" }]);
});

// Wartości z pól wpisanych ręcznie w postaci, w jakiej trafiają do plików, z nazwą pola jak
// w błędach pól: na nich strona szuka pola, które wywołało blokadę bezpiecznika plików JSON.
test("wpisane: wartości z pól wpisanych ręcznie, które trafiają do pliku, z nazwą pola jak w błędach", () => {
  const w = czytajFormularz({
    faktura: {
      ...FAKTURA, sprzedawca: "inny", sprzedawca_nazwa: " Moja spółdzielnia ", taryfa: "g12", cena_energii_netto_zl_kwh: ["0,6", "0,4"],
      oplaty_stale_inne: [{ nazwa: "", kwota_zl_mies: "" }, { nazwa: "Opłata handlowa", kwota_zl_mies: "9,99" }, { nazwa: "Zła", kwota_zl_mies: "1,234" }],
    },
    instalacja: { moc_pv_kwp: "8,4", magazyn: "tak", magazyn_pojemnosc_kwh: "10", zmiany: [{ rodzaj: "rozbudowa_pv", miesiac: "2025-05", moc_przed_kwp: "3,7" }] },
  });
  assert.deepEqual(w.wpisane, [
    { pole: "sprzedawca_nazwa", wartosc: "Moja spółdzielnia" },
    { pole: "okres_od", wartosc: "2025-04-01" },
    { pole: "okres_do", wartosc: "2025-04-30" },
    { pole: "cena_energii_netto_zl_kwh[0]", wartosc: "0.60" },
    { pole: "cena_energii_netto_zl_kwh[1]", wartosc: "0.40" },
    { pole: "oplata_mocowa_zl_mies", wartosc: "12.34" },
    { pole: "oplata_abonamentowa_zl_mies", wartosc: "5.67" },
    { pole: "oplata_stala_sieciowa_zl_mies", wartosc: "8.90" },
    { pole: "oplaty_stale_inne[1].nazwa", wartosc: "Opłata handlowa" },
    { pole: "oplaty_stale_inne[1].kwota_zl_mies", wartosc: "9.99" },
    { pole: "moc_pv_kwp", wartosc: "8.40" },
    { pole: "magazyn_pojemnosc_kwh", wartosc: "10.00" },
    { pole: "moc_przed_kwp", wartosc: "3.70" },
  ]);
  // Wartość, która nie trafia do pliku (błąd albo okres odrzucony po porównaniu dat), nie jest
  // wpisana; przy systemie opustów żadne pole faktury.
  assert.deepEqual(czytajFormularz({ faktura: { ...FAKTURA, okres_od: "2025-04-30", okres_do: "2025-04-01" } }).wpisane.filter((p) => p.pole.startsWith("okres")),
    [{ pole: "okres_od", wartosc: "2025-04-30" }]);
  assert.deepEqual(czytajFormularz({ faktura: { ...FAKTURA, system_rozliczenia: "opusty", sprzedawca: "inny", sprzedawca_nazwa: "X" } }).wpisane, []);
  assert.deepEqual(czytajFormularz({ faktura: { okres_miesiac: "2025-04" } }).wpisane, [], "okres z list miesiąca nie jest wpisany ręcznie");
  assert.deepEqual(czytajFormularz({}).wpisane, []);
});

test("zgoda tylko jako wartość logiczna true", () => {
  assert.equal(czytajFormularz({ zgoda: true }).zgoda, true);
  assert.equal(czytajFormularz({ zgoda: "true" }).zgoda, false);
});

test("operator: narzędzie wpisuje operatora z trybu, wartość z wejścia nie ma znaczenia", () => {
  const w = czytajFormularz({ faktura: { ...FAKTURA, operator_dystrybucyjny: "inny" } });
  assert.equal(w.raport.operator_dystrybucyjny, "tauron_dystrybucja");
  assert.deepEqual(Object.keys(w.raport).slice(0, 3), ["sprzedawca", "operator_dystrybucyjny", "taryfa"]);
  assert.deepEqual(czytajFormularz({ faktura: { taryfa: "g11" } }).raport, { operator_dystrybucyjny: "tauron_dystrybucja", taryfa: "g11" });
  // Niezaznaczona korekta to domyślne „rozliczeniowa”, nie odpowiedź klienta: bez innych pól
  // faktury nie ma, więc nie ma też faktury.json.
  assert.deepEqual(czytajFormularz({ faktura: { rodzaj_faktury: "rozliczeniowa" } }).raport, {});
  assert.deepEqual(czytajFormularz({ faktura: { rodzaj_faktury: "korekta" } }).raport, { operator_dystrybucyjny: "tauron_dystrybucja", rodzaj_faktury: "korekta" });
  assert.deepEqual(czytajFormularz({ faktura: { taryfa: "g11" } }, { operator: undefined }).raport, { taryfa: "g11" }, "bez trybu bez operatora");
});

test("system opustów: tylko system rozliczenia i operator, reszta pól pominięta razem z błędami", () => {
  const w = czytajFormularz({
    faktura: { ...FAKTURA, system_rozliczenia: "opusty", oplata_mocowa_zl_mies: "12,345", okres_do: "2099-01-01", cena_energii_netto_zl_kwh: "0,05" },
  });
  assert.deepEqual(w.raport, { operator_dystrybucyjny: "tauron_dystrybucja", system_rozliczenia: "opusty" });
  assert.deepEqual(Object.keys(w.raport), ["operator_dystrybucyjny", "system_rozliczenia"]);
  assert.deepEqual(w.bledy, []);
  assert.deepEqual(w.brakujace, []);
  assert.deepEqual(w.uwagi, []);
});

test("sprzedawca Pstryk", () => {
  const w = czytajFormularz({ faktura: { ...FAKTURA, sprzedawca: "pstryk" } });
  assert.equal(w.raport.sprzedawca, "pstryk");
  assert.deepEqual(w.bledy, []);
});

test("cena dynamiczna: jedna wartość; lista cen w strefach to błąd formatu", () => {
  const ok = czytajFormularz({ faktura: { ...FAKTURA, rodzaj_ceny: "dynamiczna", cena_energii_netto_zl_kwh: "0,51234" } });
  assert.equal(ok.raport.cena_energii_netto_zl_kwh, "0.51234");
  assert.deepEqual(ok.bledy, []);
  const lista = czytajFormularz({ faktura: { ...FAKTURA, rodzaj_ceny: "dynamiczna", cena_energii_netto_zl_kwh: ["0,60", "0,70", "0,40"] } });
  assert.deepEqual(lista.bledy, [{ pole: "cena_energii_netto_zl_kwh", kod: "faktura_cena_format" }]);
  assert.equal("cena_energii_netto_zl_kwh" in lista.raport, false);
});

test("okres z przyszłości: koniec po dniu z zegara urządzenia to błąd pola", () => {
  const w = czytajFormularz({ faktura: { ...FAKTURA, okres_od: "2026-11-01", okres_do: "2026-11-21" } });
  assert.deepEqual(w.bledy, [{ pole: "okres_do", kod: "faktura_okres_przyszly" }]);
  assert.equal("okres_do" in w.raport, false);
  assert.deepEqual(w.brakujace, []);
  assert.deepEqual(czytajFormularz({ faktura: { ...FAKTURA, okres_od: "2026-11-01", okres_do: "2026-11-20" } }).bledy, [], "dzisiaj");
  assert.deepEqual(czytajFormularz({ faktura: { ...FAKTURA, okres_od: "2026-11-01", okres_do: "2026-11-21" } }, { dzisiaj: undefined }).bledy, [], "bez daty");
});

test("uwaga o nietypowej cenie: każda cena poniżej 0,20 albo powyżej 2,00 zł/kWh, bez błędu", () => {
  const uwagi = (cena, faktura = {}) => czytajFormularz({ faktura: { ...FAKTURA, ...faktura, cena_energii_netto_zl_kwh: cena } }).uwagi;
  const NIETYPOWA = [{ kod: "FAKTURA_CENA_NIETYPOWA" }];
  for (const cena of ["0,19999", "2,00001", "2,10", "0,05", "9,99", "0"]) assert.deepEqual(uwagi(cena), NIETYPOWA, cena);
  for (const cena of ["0,20", "0,200000", "1,50", "1,80", "2", "2,00", "0,51234", "1,99999"]) assert.deepEqual(uwagi(cena), [], cena);
  assert.deepEqual(uwagi(["0,60", "0,70", "0,15"]), NIETYPOWA, "jedna ze stref");
  assert.deepEqual(uwagi(["0,60", "0,70", "0,40"]), []);
  assert.deepEqual(uwagi("2,10", { rodzaj_ceny: "dynamiczna" }), NIETYPOWA, "cena dynamiczna 2,1");
  const w = czytajFormularz({ faktura: { ...FAKTURA, rodzaj_ceny: "dynamiczna", cena_energii_netto_zl_kwh: "2,10" } });
  assert.deepEqual(w.bledy, []);
  assert.equal(w.raport.cena_energii_netto_zl_kwh, "2.10");
  assert.deepEqual(uwagi("0,1234567"), [], "cena w złym formacie: błąd pola, bez uwagi");
});

test("uwaga o długim okresie: więcej niż 62 dni, licząc oba końce", () => {
  const uwagi = (od, doD) => czytajFormularz({ faktura: { ...FAKTURA, okres_od: od, okres_do: doD } }).uwagi;
  assert.deepEqual(uwagi("2025-07-01", "2025-08-31"), [], "62 dni");
  assert.deepEqual(uwagi("2025-07-01", "2025-09-01"), [{ kod: "FAKTURA_OKRES_DLUGI" }], "63 dni");
  assert.deepEqual(uwagi("2025-01-01", "2025-12-31"), [{ kod: "FAKTURA_OKRES_DLUGI" }], "rok");
  const obie = czytajFormularz({ faktura: { ...FAKTURA, okres_od: "2025-01-01", okres_do: "2025-12-31", cena_energii_netto_zl_kwh: "0,10" } });
  assert.deepEqual(obie.uwagi, [{ kod: "FAKTURA_OKRES_DLUGI" }, { kod: "FAKTURA_CENA_NIETYPOWA" }]);
  assert.deepEqual(obie.bledy, []);
});

test("plik formularza: klucze operatora i pierwszego oddania już nie istnieją", () => {
  assert.equal(bladBudowyFormularza({ faktura: { operator_dystrybucyjny: "tauron_dystrybucja" } }), "faktura.operator_dystrybucyjny");
  assert.equal(bladBudowyFormularza({ instalacja: { pierwsze_oddanie: "nie_wiem" } }), "instalacja.pierwsze_oddanie");
  assert.equal(bladBudowyFormularza({ faktura: { sprzedawca: "pstryk", rodzaj_faktury: "korekta" } }), null);
});

// Miesiąc faktury (dwie listy na stronie): okres od pierwszego do ostatniego dnia miesiąca.
const BEZ_DAT = { ...FAKTURA, okres_od: "", okres_do: "" };
const zMiesiacem = (miesiac, opcje = {}) => czytajFormularz({ faktura: { ...BEZ_DAT, okres_miesiac: miesiac } }, opcje);

test("miesiąc faktury: okres od pierwszego do ostatniego dnia, format faktury bez zmian", () => {
  const w = zMiesiacem("2025-04");
  assert.deepEqual(w.bledy, []);
  assert.deepEqual(w.brakujace, []);
  assert.deepEqual(Object.entries(w.raport), Object.entries(czytajFormularz({ faktura: FAKTURA }).raport), "jak przy datach 2025-04-01 i 2025-04-30");
  assert.equal("okres_miesiac" in w.raport, false);
});

test("miesiąc faktury: długość miesiąca z kalendarza, luty w latach przestępnych", () => {
  // Dzień z zegara na końcu zakresu lat, żeby żaden miesiąc nie był bieżący ani późniejszy.
  const koniec = (m) => zMiesiacem(m, { dzisiaj: "2099-12-31" }).raport.okres_do;
  assert.equal(koniec("2024-02"), "2024-02-29");
  assert.equal(koniec("2025-02"), "2025-02-28");
  assert.equal(koniec("2028-02"), "2028-02-29");
  assert.equal(koniec("2025-12"), "2025-12-31");
  assert.equal(koniec("2025-01"), "2025-01-31");
  for (const m of ["2025-04", "2025-06", "2025-09", "2025-11"]) assert.equal(koniec(m), `${m}-30`, m);
  assert.equal(zMiesiacem("2025-02").raport.okres_od, "2025-02-01");
});

test("miesiąc faktury: miesiąc bieżący i późniejsze to błąd faktura_miesiac_biezacy", () => {
  const BLAD = [{ pole: "okres_miesiac", kod: "faktura_miesiac_biezacy" }];
  for (const m of ["2026-11", "2026-12", "2027-01"]) {
    const w = zMiesiacem(m);
    assert.deepEqual(w.bledy, BLAD, m);
    assert.equal("okres_od" in w.raport || "okres_do" in w.raport, false, m);
    assert.deepEqual(w.brakujace, [], `${m}: pole z błędem nie jest brakujące`);
  }
  assert.deepEqual(zMiesiacem("2026-10").bledy, [], "poprzedni miesiąc");
  assert.deepEqual(zMiesiacem("2026-11", { dzisiaj: "2026-11-30" }).bledy, BLAD, "ostatni dzień miesiąca");
  assert.deepEqual(zMiesiacem("2026-11", { dzisiaj: "2026-12-01" }).bledy, [], "miesiąc już się skończył");
  assert.deepEqual(zMiesiacem("2026-12", { dzisiaj: undefined }).bledy, [], "bez daty bez kontroli");
});

test("miesiąc faktury: niepełny wybór i zły format to błąd pola, puste listy to brak okresu", () => {
  for (const m of ["2026-", "-04"]) assert.deepEqual(zMiesiacem(m).bledy, [{ pole: "okres_miesiac", kod: "instalacja_miesiac_niepelny" }], m);
  for (const m of ["2026-13", "2009-12", "2025-4"]) assert.deepEqual(zMiesiacem(m).bledy, [{ pole: "okres_miesiac", kod: "instalacja_miesiac_format" }], m);
  for (const m of ["2026-", "2026-13"]) assert.deepEqual(zMiesiacem(m).brakujace, [], `${m}: pole z błędem nie jest brakujące`);
  const puste = zMiesiacem("");
  assert.deepEqual(puste.bledy, []);
  assert.deepEqual(puste.brakujace, ["okres_od", "okres_do"]);
});

test("miesiąc faktury razem z datami to błąd wyboru (plik formularza)", () => {
  const w = czytajFormularz({ faktura: { ...FAKTURA, okres_miesiac: "2025-04" } });
  assert.deepEqual(w.bledy, [{ pole: "okres_miesiac", kod: "blad_wyboru" }]);
  assert.equal("okres_od" in w.raport || "okres_do" in w.raport, false);
  assert.deepEqual(w.brakujace, []);
});

test("miesiąc faktury przy systemie opustów jest pomijany razem z błędem", () => {
  const w = czytajFormularz({ faktura: { ...BEZ_DAT, system_rozliczenia: "opusty", okres_miesiac: "2099-12" } });
  assert.deepEqual(w.raport, { operator_dystrybucyjny: "tauron_dystrybucja", system_rozliczenia: "opusty" });
  assert.deepEqual(w.bledy, []);
});

test("plik formularza: okres_miesiac jako tekst", () => {
  assert.equal(bladBudowyFormularza({ faktura: { okres_miesiac: "2025-04" } }), null);
  assert.equal(bladBudowyFormularza({ faktura: { okres_miesiac: 202504 } }), "faktura.okres_miesiac");
});

test("okresMiesiaca: pierwszy i ostatni dzień miesiąca, ten sam co w faktury.json", () => {
  assert.deepEqual(okresMiesiaca("2024-02"), { od: "2024-02-01", do: "2024-02-29" });
  assert.deepEqual(okresMiesiaca("2025-02"), { od: "2025-02-01", do: "2025-02-28" });
  assert.deepEqual(okresMiesiaca("2025-12"), { od: "2025-12-01", do: "2025-12-31" });
  assert.deepEqual(okresMiesiaca("2025-04"), { od: "2025-04-01", do: "2025-04-30" });
  for (const zly of ["", "2025-13", "2025-4", "2009-12", "2025-", null]) assert.equal(okresMiesiaca(zly), null, String(zly));
  const w = zMiesiacem("2024-02", { dzisiaj: "2026-11-20" });
  assert.deepEqual([w.raport.okres_od, w.raport.okres_do], ["2024-02-01", "2024-02-29"]);
});

test("sprzedawca z listy wpisany jako „inny”: nazwa jako osobne słowo albo fraza", () => {
  for (const tak of ["Tauron Sprzedaż", "TAURON", "tauron sprzedaż gze", "E.ON Polska", "e-on", "EON", "E ON", "PGE Obrót", "pge",
    "Pstryk", "Enea S.A.", "Energa-Obrót", "Energa", "Sprzedawca (Tauron)"]) {
    assert.equal(sprzedawcaZListy(tak), true, tak);
  }
  for (const nie of ["", "   ", "Energetyka Lokalna", "Peonia", "Taurus", "Eneasz", "Pstrykacz", "Moja spółdzielnia", "Leon", "GEO N", "Tauron2"]) {
    assert.equal(sprzedawcaZListy(nie), false, nie);
  }
  assert.equal(sprzedawcaZListy(42), false);
  // Tylko podpowiedź na stronie: nazwa trafia do faktury bez zmian, bez błędu i bez uwagi.
  const w = czytajFormularz({ faktura: { ...FAKTURA, sprzedawca: "inny", sprzedawca_nazwa: "Tauron Sprzedaż" } });
  assert.equal(w.raport.sprzedawca_nazwa, "Tauron Sprzedaż");
  assert.deepEqual(w.bledy, []);
  assert.deepEqual(w.uwagi, []);
});
