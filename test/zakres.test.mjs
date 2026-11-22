// Kilka plików i zakres: porównanie punktów poboru, nakładanie się plików, pełne miesiące,
// ciąg i klasyfikacja. Dane z generatora; ta sama godzina ma tę samą wartość przy tym samym
// ziarnie, więc pliki o zachodzących zakresach są zgodne, dopóki ich nie zepsujemy.

import { test } from "node:test";
import assert from "node:assert/strict";

import { dekoduj } from "../app/lib/dekodowanie.js";
import { czytajTauron } from "../app/lib/tauron.js";
import { analizujZakres, okresWPelnychDobach, miesiaceFaktury } from "../app/lib/zakres.js";
import { generuj, PPE_FIKCYJNE, PLATNICY_FIKCYJNI } from "../narzedzia/generator.mjs";

function plik(opcje, wariant = "surowy") {
  const wynik = generuj({ ziarno: 11, ...opcje });
  const w = czytajTauron(dekoduj(wariant === "surowy" ? wynik.surowy : wynik.bezNumerow).tekst);
  assert.equal(w.ok, true, JSON.stringify(w));
  return w;
}

const analiza = (...opcje) => analizujZakres(opcje.map((o) => plik(o)));
const kody = (a) => a.uwagi.map((u) => u.kod);
const kwh = (wh) => `${Math.floor(wh / 1000)},${String(wh % 1000).padStart(3, "0")}`;

// Wartość poboru w danej godzinie, żeby zepsuć ją o 1 Wh.
function wartoscPoboru(opcje, znacznik) {
  return plik(opcje).wiersze.find((w) => w.seria === "pobor" && w.znacznik === znacznik).wh;
}

test("jeden plik surowy: punkty poboru porównane, bez blokad", () => {
  const a = analiza({ od: "2025-01-01", do: "2025-01-31" });
  assert.deepEqual(a.blokady, []);
  assert.equal(a.ppePorownane, true);
  assert.deepEqual(a.zakres, { pelne_miesiace: 1, ciag_od: "2025-01", ciag_do: "2025-01", ciag_miesiace: 1, klasyfikacja: "za_krotki" });
});

test("N6: dwa pliki z różnym PPE albo różnym płatnikiem: blokada blad_rozne_ppe", () => {
  const a = analiza({ od: "2025-01-01", do: "2025-01-10" }, { od: "2025-01-11", do: "2025-01-20", ppe: PPE_FIKCYJNE[1] });
  assert.deepEqual(a.blokady, [{ kod: "blad_rozne_ppe" }]);
  const b = analiza({ od: "2025-01-01", do: "2025-01-10" }, { od: "2025-01-11", do: "2025-01-20", platnik: PLATNICY_FIKCYJNI[1] });
  assert.deepEqual(b.blokady, [{ kod: "blad_rozne_ppe" }]);
});

test("plik bez numerów: punktów poboru nie da się porównać", () => {
  const a = analizujZakres([plik({ od: "2025-01-01", do: "2025-01-10" }), plik({ od: "2025-01-11", do: "2025-01-20" }, "bez_numerow")]);
  assert.deepEqual(a.blokady, []);
  assert.equal(a.ppePorownane, false);
  assert.equal(analizujZakres([plik({ od: "2025-01-01", do: "2025-01-10" }, "bez_numerow")]).ppePorownane, false);
});

test("plik z pustą kolumną numeru: bez porównania punktów poboru i bez blokady", () => {
  for (const pusta of [{ ppe: "" }, { platnik: "" }]) {
    const a = analiza({ od: "2025-01-01", do: "2025-01-10" }, { od: "2025-01-11", do: "2025-01-20", ...pusta });
    assert.deepEqual(a.blokady, [], JSON.stringify(pusta));
    assert.equal(a.ppePorownane, false, JSON.stringify(pusta));
  }
  const dwaPuste = analiza({ od: "2025-01-01", do: "2025-01-10", ppe: "" }, { od: "2025-01-11", do: "2025-01-20", ppe: "" });
  assert.equal(dwaPuste.ppePorownane, false, "dwa pliki z pustym PPE to nie dowód jednego punktu");
});

test("N8: dwa pliki zachodzące na siebie o 48 godzin, te same wartości: zakres z sumy godzin", () => {
  const a = analiza({ od: "2025-01-01", do: "2025-02-02" }, { od: "2025-02-01", do: "2025-03-31" });
  assert.deepEqual(a.blokady, []);
  assert.deepEqual(a.zakres, { pelne_miesiace: 3, ciag_od: "2025-01", ciag_do: "2025-03", ciag_miesiace: 3, klasyfikacja: "za_krotki" });
  assert.deepEqual(kody(a), []);
});

test("N9: jak N8, jedna wartość różna o 0,001 kWh: blokada blad_sprzeczne z datą", () => {
  const z = "2025-02-01 05:00";
  const wh = wartoscPoboru({ od: "2025-02-01", do: "2025-02-02" }, z);
  const a = analiza(
    { od: "2025-01-01", do: "2025-02-02" },
    { od: "2025-02-01", do: "2025-03-31", podmien: [{ znacznik: z, seria: "pobor", pole: "wartosc", tekst: kwh(wh + 1) }] },
  );
  assert.deepEqual(a.blokady, [{ kod: "blad_sprzeczne", znacznik: z }]);
});

test("blad_sprzeczne podaje najwcześniejszą sprzeczną godzinę", () => {
  const z1 = "2025-02-02 07:00";
  const z2 = "2025-02-01 22:00";
  const opcje = { od: "2025-02-01", do: "2025-02-02" };
  const a = analiza(
    { od: "2025-01-01", do: "2025-02-02" },
    {
      od: "2025-02-01", do: "2025-03-31",
      podmien: [
        { znacznik: z1, seria: "pobor", pole: "wartosc", tekst: kwh(wartoscPoboru(opcje, z1) + 5) },
        { znacznik: z2, seria: "pobor", pole: "wartosc", tekst: kwh(wartoscPoboru(opcje, z2) + 5) },
      ],
    },
  );
  assert.deepEqual(a.blokady, [{ kod: "blad_sprzeczne", znacznik: z2 }]);
});

test("N10: część wspólna z dobą 25-godzinną, para 03:00 odwrócona w drugim pliku: przyjęte", () => {
  const a = analiza({ od: "2025-10-01", do: "2025-10-27" }, { od: "2025-10-25", do: "2025-11-30", odwrocPare: true });
  assert.deepEqual(a.blokady, []);
  assert.equal(a.zakres.pelne_miesiace, 2);
  assert.deepEqual(kody(a), []);
});

test("N11: jak N10, jedna wartość pary różna: blokada blad_sprzeczne", () => {
  const z = "2025-10-26 03:00";
  const wh = wartoscPoboru({ od: "2025-10-26", do: "2025-10-26" }, z);
  const a = analiza(
    { od: "2025-10-01", do: "2025-10-27" },
    { od: "2025-10-25", do: "2025-11-30", odwrocPare: true, podmien: [{ znacznik: z, seria: "pobor", pole: "wartosc", tekst: kwh(wh + 1) }] },
  );
  assert.deepEqual(a.blokady, [{ kod: "blad_sprzeczne", znacznik: z }]);
});

test("N11: zmiana jednej wartości pary przy niezmienionej drugiej też jest sprzecznością", () => {
  const z = "2025-10-26 03:00";
  const para = plik({ od: "2025-10-26", do: "2025-10-26" }).wiersze.filter((w) => w.seria === "pobor" && w.znacznik === z);
  const [pierwsza, druga] = para.map((w) => w.wh);
  assert.notEqual(pierwsza, druga);
  // Zmieniamy pierwszy wiersz tak, żeby po posortowaniu pary druga wartość została na miejscu:
  // większą zwiększamy, mniejszą zmniejszamy.
  const nowa = pierwsza > druga ? pierwsza + 1 : pierwsza - 1;
  const a = analiza(
    { od: "2025-10-01", do: "2025-10-27" },
    { od: "2025-10-25", do: "2025-11-30", podmien: [{ znacznik: z, seria: "pobor", pole: "wartosc", tekst: kwh(nowa) }] },
  );
  assert.deepEqual(a.blokady, [{ kod: "blad_sprzeczne", znacznik: z }]);
});

test("N12: jeden plik kończy się na pierwszym wierszu 03:00, drugi zaczyna od drugiego: ciąg bez przerwy", () => {
  const a = analiza(
    { od: "2025-09-01", do: "2025-10-26", obetnijKoniec: 22 },
    { od: "2025-10-26", do: "2025-11-30", obetnijPoczatek: 3 },
  );
  assert.deepEqual(a.blokady, []);
  assert.deepEqual(a.zakres, { pelne_miesiace: 3, ciag_od: "2025-09", ciag_do: "2025-11", ciag_miesiace: 3, klasyfikacja: "za_krotki" });
  assert.deepEqual(kody(a), []);
});

test("pojedynczy wiersz 03:00 a para w drugim pliku: wartość musi być jedną z pary", () => {
  const z = "2025-10-26 03:00";
  const zgodne = analiza({ od: "2025-10-01", do: "2025-10-26", obetnijKoniec: 22 }, { od: "2025-10-26", do: "2025-10-31" });
  assert.deepEqual(zgodne.blokady, []);
  assert.equal(zgodne.zakres.pelne_miesiace, 1);
  const para = plik({ od: "2025-10-26", do: "2025-10-26" }).wiersze.filter((w) => w.seria === "pobor" && w.znacznik === z);
  const inna = Math.max(para[0].wh, para[1].wh) + 7;
  const sprzeczne = analiza(
    { od: "2025-10-01", do: "2025-10-26", obetnijKoniec: 22, podmien: [{ znacznik: z, seria: "pobor", pole: "wartosc", tekst: kwh(inna) }] },
    { od: "2025-10-26", do: "2025-10-31" },
  );
  assert.deepEqual(sprzeczne.blokady, [{ kod: "blad_sprzeczne", znacznik: z }]);
});

test("jeden wiersz 03:00 w środku serii (drugiego brak): miesiąc niepełny", () => {
  const linie = new TextDecoder("iso-8859-2").decode(generuj({ od: "2025-10-01", do: "2025-10-31", ziarno: 11 }).surowy).split("\r\n");
  const bezDrugich = linie.filter((l, i) => {
    if (!l.includes(";2025-10-26 03:00;")) return true;
    return linie.slice(0, i).every((p) => !p.includes(l.split(";")[2] + ";2025-10-26 03:00;"));
  });
  assert.equal(bezDrugich.length, linie.length - 2);
  const w = czytajTauron(bezDrugich.join("\r\n"));
  const a = analizujZakres([w]);
  assert.deepEqual(a.blokady, []);
  assert.equal(a.zakres.pelne_miesiace, 0);
  assert.deepEqual(kody(a), ["ZAKRES_NIEPELNY"]);
});

test("N13: 12 miesięcy raport, 11 wynik wstępny, 5 za krótki, z dobami 23 i 25 godzin", () => {
  assert.deepEqual(analiza({ od: "2025-01-01", do: "2025-12-31" }).zakres, {
    pelne_miesiace: 12, ciag_od: "2025-01", ciag_do: "2025-12", ciag_miesiace: 12, klasyfikacja: "raport",
  });
  assert.deepEqual(analiza({ od: "2024-12-01", do: "2025-10-31" }).zakres, {
    pelne_miesiace: 11, ciag_od: "2024-12", ciag_do: "2025-10", ciag_miesiace: 11, klasyfikacja: "wynik_wstepny",
  });
  assert.deepEqual(analiza({ od: "2025-01-01", do: "2025-05-31" }).zakres, {
    pelne_miesiace: 5, ciag_od: "2025-01", ciag_do: "2025-05", ciag_miesiace: 5, klasyfikacja: "za_krotki",
  });
});

test("N14a: plik od 19. dnia miesiąca: zakres_niepelny, pierwszy miesiąc nie liczy się", () => {
  const a = analiza({ od: "2025-01-19", do: "2025-06-30" });
  assert.deepEqual(a.zakres, { pelne_miesiace: 5, ciag_od: "2025-02", ciag_do: "2025-06", ciag_miesiace: 5, klasyfikacja: "za_krotki" });
  assert.deepEqual(a.uwagi, [{ kod: "ZAKRES_NIEPELNY", od: { rok: 2025, miesiac: 1, dzien: 19 }, do: { rok: 2025, miesiac: 6, dzien: 30 } }]);
});

test("N14b: luka 3 godzin w środku pliku: miesiąc z luką niepełny i przerwa ciągu", () => {
  const a = analiza({ od: "2025-01-01", do: "2025-06-30", luka: { znacznik: "2025-03-10 10:00", godzin: 3 } });
  assert.deepEqual(a.zakres, { pelne_miesiace: 5, ciag_od: "2025-04", ciag_do: "2025-06", ciag_miesiace: 3, klasyfikacja: "za_krotki" });
  assert.deepEqual(a.uwagi, [{ kod: "ZAKRES_LUKA", od: { rok: 2025, miesiac: 3, dzien: 10 }, do: { rok: 2025, miesiac: 3, dzien: 10 } }]);
});

test("N14c: zmiana etykiet z G13 na G11: ciąg zaczyna się po zmianie taryfy", () => {
  const a = analiza({ od: "2025-01-01", do: "2025-06-30", zmianaTaryfy: { od: "2025-04-01", taryfa: "G11" } });
  assert.deepEqual(a.zakres, { pelne_miesiace: 6, ciag_od: "2025-04", ciag_do: "2025-06", ciag_miesiace: 3, klasyfikacja: "za_krotki" });
  assert.deepEqual(a.uwagi, [{ kod: "ZAKRES_TARYFA", od: { rok: 2025, miesiac: 4 } }]);
});

test("zmiana taryfy w środku miesiąca: ciąg zaczyna się od następnego miesiąca", () => {
  const a = analiza({ od: "2025-01-01", do: "2025-06-30", zmianaTaryfy: { od: "2025-04-16", taryfa: "G11" } });
  assert.equal(a.zakres.ciag_od, "2025-05");
  assert.deepEqual(a.uwagi, [{ kod: "ZAKRES_TARYFA", od: { rok: 2025, miesiac: 5 } }]);
});

test("przerwa między plikami: zakres_przerwa z pierwszym i ostatnim dniem bez danych", () => {
  const a = analiza({ od: "2025-01-01", do: "2025-03-31" }, { od: "2025-05-01", do: "2025-06-30" });
  assert.deepEqual(a.zakres, { pelne_miesiace: 5, ciag_od: "2025-05", ciag_do: "2025-06", ciag_miesiace: 2, klasyfikacja: "za_krotki" });
  assert.deepEqual(a.uwagi, [{ kod: "ZAKRES_PRZERWA", od: { rok: 2025, miesiac: 4, dzien: 1 }, do: { rok: 2025, miesiac: 4, dzien: 30 } }]);
});

test("zero pełnych miesięcy: bez ciag_od i ciag_do, zakres_niepelny", () => {
  const a = analiza({ od: "2025-06-06", do: "2025-06-07" });
  assert.deepEqual(a.zakres, { pelne_miesiace: 0, ciag_miesiace: 0, klasyfikacja: "za_krotki" });
  assert.deepEqual(kody(a), ["ZAKRES_NIEPELNY"]);
});

test("kompletność poniżej 100 nie odbiera miesiącowi pełności", () => {
  const a = analiza({ od: "2025-01-01", do: "2025-01-31", niepelne: [{ znacznik: "2025-01-10 05:00", kompletnosc: "0,00" }] });
  assert.equal(a.zakres.pelne_miesiace, 1);
});

test("nakładanie: inna strefa albo kompletność przy tej samej wartości daje tylko uwagę", () => {
  const z = "2025-02-01 05:00";
  const a = analiza(
    { od: "2025-01-01", do: "2025-02-02" },
    { od: "2025-02-01", do: "2025-02-28", podmien: [{ znacznik: z, seria: "pobor", pole: "strefa", tekst: "Inna strefa" }], niepelne: [{ znacznik: "2025-02-01 06:00", kompletnosc: "99,00" }] },
  );
  assert.deepEqual(a.blokady, []);
  assert.deepEqual(kody(a), ["NAKLADANIE_STREFA", "NAKLADANIE_KOMPLETNOSC"]);
});

test("powtórzony znacznik w jednym pliku: ta sama wartość bez skutku, inna wartość blad_sprzeczne", () => {
  const z = "2025-02-03 05:00";
  assert.deepEqual(analiza({ od: "2025-02-01", do: "2025-02-28", powtorz: { znacznik: z, seria: "pobor" } }).blokady, []);
  const wh = wartoscPoboru({ od: "2025-02-03", do: "2025-02-03" }, z);
  assert.deepEqual(
    analiza({ od: "2025-02-01", do: "2025-02-28", powtorz: { znacznik: z, seria: "pobor", wartoscWh: wh + 1 } }).blokady,
    [{ kod: "blad_sprzeczne", znacznik: z }],
  );
});

test("pełne doby i okres faktury", () => {
  const a = analiza({ od: "2025-01-19", do: "2025-02-28", luka: { znacznik: "2025-02-10 10:00", godzin: 1 } });
  const d = (rok, miesiac, dzien) => ({ rok, miesiac, dzien });
  assert.equal(okresWPelnychDobach(a, d(2025, 1, 19), d(2025, 2, 9)), true);
  assert.equal(okresWPelnychDobach(a, d(2025, 1, 19), d(2025, 2, 10)), false, "doba z luką");
  assert.equal(okresWPelnychDobach(a, d(2025, 1, 18), d(2025, 1, 31)), false, "dzień przed plikiem");
  assert.equal(okresWPelnychDobach(a, d(2025, 2, 11), d(2025, 2, 28)), true);
  assert.equal(okresWPelnychDobach(a, d(2025, 2, 11), d(2025, 3, 1)), false);
});

test("sumy miesięczne do podglądu bez podwójnego liczenia nakładających się godzin", () => {
  const pojedynczy = analiza({ od: "2025-01-01", do: "2025-02-28" });
  const nakladajace = analiza({ od: "2025-01-01", do: "2025-02-10" }, { od: "2025-02-01", do: "2025-02-28" });
  assert.deepEqual(nakladajace.miesiace, pojedynczy.miesiace);
  assert.equal(pojedynczy.miesiace.length, 2);
  const w = plik({ od: "2025-01-01", do: "2025-01-31" }).wiersze;
  const suma = (seria) => w.filter((x) => x.seria === seria).reduce((s, x) => s + x.wh, 0);
  assert.deepEqual(pojedynczy.miesiace[0], { rok: 2025, miesiac: 1, poborWh: suma("pobor"), oddanieWh: suma("oddanie") });
  assert.deepEqual(pojedynczy.miesiacePlikow, { od: { rok: 2025, miesiac: 1 }, do: { rok: 2025, miesiac: 2 } });
});

// Lista miesięcy do wyboru miesiąca faktury: pełne miesiące ze wszystkich przyjętych plików,
// policzone przez analizę zakresu, bez powtórzeń, od najnowszego.
const wartosci = (lista) => lista.map((m) => m.wartosc);

test("miesiące faktury: jeden plik, od najnowszego, z rokiem i miesiącem liczbowo", () => {
  const lista = miesiaceFaktury(analiza({ od: "2025-01-01", do: "2025-03-31" }));
  assert.deepEqual(lista, [
    { rok: 2025, miesiac: 3, wartosc: "2025-03" },
    { rok: 2025, miesiac: 2, wartosc: "2025-02" },
    { rok: 2025, miesiac: 1, wartosc: "2025-01" },
  ]);
});

test("miesiące faktury: kilka plików z przerwą, w kolejności wyboru innej niż kalendarz", () => {
  const a = analiza({ od: "2025-05-01", do: "2025-06-30" }, { od: "2025-01-01", do: "2025-03-31" });
  assert.deepEqual(wartosci(miesiaceFaktury(a)), ["2025-06", "2025-05", "2025-03", "2025-02", "2025-01"]);
  // Te same miesiące co w liczbie pełnych miesięcy z analizy zakresu, a nie tylko z ciągu.
  assert.equal(miesiaceFaktury(a).length, a.zakres.pelne_miesiace);
  assert.equal(a.zakres.ciag_miesiace, 2);
});

test("miesiące faktury: pliki zachodzące na siebie dają każdy miesiąc raz", () => {
  const a = analiza({ od: "2025-01-01", do: "2025-02-10" }, { od: "2025-02-01", do: "2025-03-31" }, { od: "2025-01-01", do: "2025-01-31" });
  assert.deepEqual(wartosci(miesiaceFaktury(a)), ["2025-03", "2025-02", "2025-01"]);
});

test("miesiące faktury: niepełne miesiące na brzegach i miesiąc z luką nie trafiają na listę", () => {
  assert.deepEqual(wartosci(miesiaceFaktury(analiza({ od: "2025-01-19", do: "2025-03-15" }))), ["2025-02"]);
  const zLuka = analiza({ od: "2025-01-01", do: "2025-03-31", luka: { znacznik: "2025-02-10 10:00", godzin: 3 } });
  assert.deepEqual(wartosci(miesiaceFaktury(zLuka)), ["2025-03", "2025-01"]);
});

test("miesiące faktury: plik bez pełnego miesiąca i brak plików dają pustą listę", () => {
  assert.deepEqual(miesiaceFaktury(analiza({ od: "2025-06-06", do: "2025-06-07" })), []);
  assert.deepEqual(miesiaceFaktury(null), []);
  assert.deepEqual(miesiaceFaktury(undefined), []);
});

test("miesiące faktury: tylko lata z zakresu list wyboru, gdy zakres jest podany", () => {
  const a = analiza({ od: "2021-11-01", do: "2022-02-28" });
  assert.deepEqual(wartosci(miesiaceFaktury(a)), ["2022-02", "2022-01", "2021-12", "2021-11"]);
  assert.deepEqual(wartosci(miesiaceFaktury(a, { odRoku: 2022 })), ["2022-02", "2022-01"]);
  assert.deepEqual(wartosci(miesiaceFaktury(a, { doRoku: 2021 })), ["2021-12", "2021-11"]);
  assert.deepEqual(miesiaceFaktury(a, { odRoku: 2023 }), []);
});

test("miesiące faktury: wynik to nowa lista, zmiana jej nie psuje analizy", () => {
  const a = analiza({ od: "2025-01-01", do: "2025-02-28" });
  miesiaceFaktury(a).length = 0;
  assert.deepEqual(wartosci(miesiaceFaktury(a)), ["2025-02", "2025-01"]);
});
