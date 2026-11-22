// Kilka plików jednego zgłoszenia: ten sam punkt poboru, nakładanie się plików, pełne miesiące,
// ciąg i klasyfikacja. Zakres tylko informuje; blokują wyłącznie różne punkty poboru
// i sprzeczne wartości tej samej godziny.
//
// Zasady:
// - pliki surowe muszą mieć ten sam numer płatnika i PPE; porównanie tylko w pamięci;
// - godzina obecna w kilku plikach (albo dwa razy w jednym) jest porównywana osobno w każdej
//   serii czynnej: inna wartość Wh to blokada, inna strefa albo kompletność przy tej samej
//   wartości to tylko uwaga;
// - dwa wiersze 03:00 doby zmiany czasu na zimowy porównujemy jako parę bez kolejności, bo
//   kolejność wierszy w pliku nie mówi, która godzina była pierwsza; pojedynczy wiersz musi
//   być równy jednej z wartości pary z innego pliku;
// - miesiąc jest pełny, gdy każda jego godzina jest w obu seriach, w którymkolwiek pliku;
//   kompletność poniżej 100 nie odbiera pełności;
// - ciąg to najdłuższy ciąg kolejnych pełnych miesięcy kończący się na ostatnim pełnym
//   miesiącu; zmiana zbioru etykiet stref między miesiącami (zmiana taryfy) przerywa ciąg;
// - klasyfikacja: 12 i więcej miesięcy raport, 6–11 wynik wstępny, mniej za krótki.

import {
  dobaZmianyNaZimowy,
  godzinyDoby,
  numerDnia,
  dobaZNumeru,
  porzadek,
  zPorzadku,
  dniMiesiaca,
  numerMiesiaca,
  miesiacZNumeru,
  istniejeGodzina,
} from "./kalendarz.js";

const AKTYWNE = ["oddanie", "pobor"];

const dwie = (n) => String(n).padStart(2, "0");
const tekstMiesiaca = ({ rok, miesiac }) => `${rok}-${dwie(miesiac)}`;

function godzinyMiesiaca(nrMiesiaca) {
  const { rok, miesiac } = miesiacZNumeru(nrMiesiaca);
  const wynik = [];
  for (let dzien = 1; dzien <= dniMiesiaca(rok, miesiac); dzien++) {
    const doba = { rok, miesiac, dzien };
    for (const { godzina, wystapienie } of godzinyDoby(doba)) wynik.push(porzadek(doba, godzina, wystapienie));
  }
  return wynik;
}

function klasyfikacja(n) {
  if (n >= 12) return "raport";
  if (n >= 6) return "wynik_wstepny";
  return "za_krotki";
}

function porownajPunkty(pliki) {
  const surowe = pliki.filter((p) => p.identyfikatory);
  const [pierwszy, ...reszta] = surowe;
  const rozne = reszta.some(
    (p) => p.identyfikatory.ppe !== pierwszy.identyfikatory.ppe || p.identyfikatory.platnik !== pierwszy.identyfikatory.platnik,
  );
  return { rozne, porownane: pliki.length > 0 && surowe.length === pliki.length };
}

// Łączy godziny wszystkich plików w mapę porządek -> wiersz dla każdej serii czynnej.
function polacz(pliki) {
  const godziny = { oddanie: new Map(), pobor: new Map() };
  const konflikty = [];
  const nakladanie = { strefa: false, kompletnosc: false };
  // Wiersze godziny powtórzonej: seria -> numer dnia -> lista wierszy każdego pliku.
  const powtorzone = { oddanie: new Map(), pobor: new Map() };

  const porownaj = (a, b) => {
    if (a.wh !== b.wh) konflikty.push(b);
    else {
      if (a.strefa !== b.strefa) nakladanie.strefa = true;
      if (a.kompletnosc !== b.kompletnosc) nakladanie.kompletnosc = true;
    }
  };

  pliki.forEach((plik, nrPliku) => {
    for (const w of plik.wiersze) {
      if (!AKTYWNE.includes(w.seria)) continue;
      if (w.godzina === 2 && dobaZmianyNaZimowy(w.doba)) {
        const dni = powtorzone[w.seria];
        const dzien = numerDnia(w.doba);
        if (!dni.has(dzien)) dni.set(dzien, []);
        const listy = dni.get(dzien);
        (listy[nrPliku] ??= []).push(w);
        continue;
      }
      if (!istniejeGodzina(w.doba, w.godzina, w.wystapienie)) continue;
      const mapa = godziny[w.seria];
      const istniejacy = mapa.get(w.porzadek);
      if (istniejacy) porownaj(istniejacy, w);
      else mapa.set(w.porzadek, w);
    }
  });

  for (const seria of AKTYWNE) {
    for (const [dzien, listyPlikow] of powtorzone[seria]) {
      const listy = listyPlikow.filter(Boolean);
      const mapa = godziny[seria];
      const doba = dobaZNumeru(dzien);
      const pary = listy.filter((l) => l.length >= 2);
      if (pary.length > 0) {
        const wzor = [pary[0][0].wh, pary[0][1].wh].sort((a, b) => a - b);
        for (const lista of listy) {
          if (lista.length >= 2) {
            const para = [lista[0].wh, lista[1].wh].sort((a, b) => a - b);
            if (para[0] !== wzor[0] || para[1] !== wzor[1]) konflikty.push(lista[0]);
          }
          for (const w of lista.length >= 2 ? lista.slice(2) : lista) {
            if (!wzor.includes(w.wh)) konflikty.push(w);
          }
        }
        mapa.set(porzadek(doba, 2, 1), pary[0][0]);
        mapa.set(porzadek(doba, 2, 2), pary[0][1]);
      } else {
        for (const w of listy.flat()) {
          const istniejacy = mapa.get(w.porzadek);
          if (istniejacy) porownaj(istniejacy, w);
          else mapa.set(w.porzadek, w);
        }
      }
    }
  }
  return { godziny, konflikty, nakladanie };
}

export function analizujZakres(pliki) {
  const blokady = [];
  const punkty = porownajPunkty(pliki);
  if (punkty.rozne) blokady.push({ kod: "blad_rozne_ppe" });

  const { godziny, konflikty, nakladanie } = polacz(pliki);
  if (konflikty.length > 0) {
    const pierwszy = konflikty.reduce((a, b) => (b.porzadek < a.porzadek ? b : a));
    blokady.push({ kod: "blad_sprzeczne", znacznik: pierwszy.znacznik });
  }

  const uwagi = [];
  if (nakladanie.strefa) uwagi.push({ kod: "NAKLADANIE_STREFA" });
  if (nakladanie.kompletnosc) uwagi.push({ kod: "NAKLADANIE_KOMPLETNOSC" });

  const obecna = (p) => godziny.oddanie.has(p) && godziny.pobor.has(p);
  let minP = Infinity;
  let maxP = -Infinity;
  for (const s of AKTYWNE) {
    for (const p of godziny[s].keys()) {
      if (p < minP) minP = p;
      if (p > maxP) maxP = p;
    }
  }
  if (minP === Infinity) {
    return { blokady, ppePorownane: punkty.porownane, uwagi, zakres: { pelne_miesiace: 0, ciag_miesiace: 0, klasyfikacja: "za_krotki" }, pelneDoby: new Set(), miesiace: [], miesiacePelne: [], miesiacePlikow: null };
  }
  const doMiesiaca = (p) => {
    const { doba } = zPorzadku(p);
    return numerMiesiaca(doba.rok, doba.miesiac);
  };
  const pierwszyMiesiac = doMiesiaca(minP);
  const ostatniMiesiac = doMiesiaca(maxP);

  // Pełność i etykiety stref w każdym miesiącu zakresu.
  const pelny = new Map();
  const etykiety = new Map();
  for (let m = pierwszyMiesiac; m <= ostatniMiesiac; m++) {
    const zbior = new Set();
    let wszystkie = true;
    for (const p of godzinyMiesiaca(m)) {
      if (!obecna(p)) wszystkie = false;
      for (const s of AKTYWNE) {
        const w = godziny[s].get(p);
        if (w) zbior.add(w.strefa);
      }
    }
    pelny.set(m, wszystkie);
    etykiety.set(m, [...zbior].sort().join("\n"));
  }
  const pelneMiesiace = [...pelny].filter(([, p]) => p).map(([m]) => m);

  // Ciąg kończący się na ostatnim pełnym miesiącu.
  let ciag = null;
  if (pelneMiesiace.length > 0) {
    const koniec = Math.max(...pelneMiesiace);
    let poczatek = koniec;
    let powod;
    for (;;) {
      const poprzedni = poczatek - 1;
      if (!pelny.get(poprzedni)) {
        powod = "niepelny";
        break;
      }
      if (etykiety.get(poprzedni) !== etykiety.get(poczatek)) {
        powod = "taryfa";
        break;
      }
      poczatek = poprzedni;
    }
    ciag = { poczatek, koniec, n: koniec - poczatek + 1 };

    if (powod === "taryfa") {
      uwagi.push({ kod: "ZAKRES_TARYFA", od: miesiacZNumeru(poczatek) });
    } else {
      // Najpóźniejsza brakująca godzina przed ciągiem; jeśli jest przed początkiem danych,
      // ciąg zaczyna się po prostu tam, gdzie dane.
      const przed = poczatek - 1 >= pierwszyMiesiac ? godzinyMiesiaca(poczatek - 1) : [];
      const koniecLuki = [...przed].reverse().find((p) => !obecna(p));
      if (koniecLuki !== undefined && koniecLuki > minP) {
        let poczatekLuki = koniecLuki;
        let m = poczatek - 1;
        let godzinyM = godzinyMiesiaca(m);
        let i = godzinyM.indexOf(koniecLuki);
        for (;;) {
          i -= 1;
          if (i < 0) {
            m -= 1;
            if (m < pierwszyMiesiac) break;
            godzinyM = godzinyMiesiaca(m);
            i = godzinyM.length - 1;
          }
          const p = godzinyM[i];
          if (obecna(p) || p < minP) break;
          poczatekLuki = p;
        }
        const wPliku = pliki.some((pl) => pl.pierwszyPorzadek < poczatekLuki && pl.ostatniPorzadek > koniecLuki);
        uwagi.push({
          kod: wPliku ? "ZAKRES_LUKA" : "ZAKRES_PRZERWA",
          od: zPorzadku(poczatekLuki).doba,
          do: zPorzadku(koniecLuki).doba,
        });
      }
    }
  }

  if (!pelny.get(pierwszyMiesiac) || !pelny.get(ostatniMiesiac)) {
    // Ma być przed uwagami o przerwie i taryfie: najpierw okres danych, potem ciąg.
    const pozycja = uwagi.findIndex((u) => u.kod.startsWith("ZAKRES_"));
    const niepelny = { kod: "ZAKRES_NIEPELNY", od: zPorzadku(minP).doba, do: zPorzadku(maxP).doba };
    if (pozycja < 0) uwagi.push(niepelny);
    else uwagi.splice(pozycja, 0, niepelny);
  }

  // Pełne doby (do sprawdzenia okresu faktury).
  const pelneDoby = new Set();
  for (let d = numerDnia(zPorzadku(minP).doba); d <= numerDnia(zPorzadku(maxP).doba); d++) {
    const doba = dobaZNumeru(d);
    if (godzinyDoby(doba).every(({ godzina, wystapienie }) => obecna(porzadek(doba, godzina, wystapienie)))) pelneDoby.add(d);
  }

  // Sumy miesięczne energii do podglądu, każda godzina policzona raz.
  const sumy = new Map();
  for (const seria of AKTYWNE) {
    for (const [p, w] of godziny[seria]) {
      const m = doMiesiaca(p);
      if (!sumy.has(m)) sumy.set(m, { poborWh: 0, oddanieWh: 0 });
      sumy.get(m)[seria === "pobor" ? "poborWh" : "oddanieWh"] += w.wh;
    }
  }
  const miesiace = [...sumy.keys()].sort((a, b) => a - b).map((m) => ({ ...miesiacZNumeru(m), ...sumy.get(m) }));

  const zakres = ciag
    ? {
        pelne_miesiace: pelneMiesiace.length,
        ciag_od: tekstMiesiaca(miesiacZNumeru(ciag.poczatek)),
        ciag_do: tekstMiesiaca(miesiacZNumeru(ciag.koniec)),
        ciag_miesiace: ciag.n,
        klasyfikacja: klasyfikacja(ciag.n),
      }
    : { pelne_miesiace: 0, ciag_miesiace: 0, klasyfikacja: "za_krotki" };

  return {
    blokady,
    ppePorownane: punkty.porownane,
    uwagi,
    zakres,
    pelneDoby,
    miesiace,
    // Pełne miesiące w kolejności kalendarza ({ rok, miesiac }); tylko na stronę, nie do plików.
    miesiacePelne: pelneMiesiace.map(miesiacZNumeru),
    miesiacePlikow: { od: miesiacZNumeru(pierwszyMiesiac), do: miesiacZNumeru(ostatniMiesiac) },
  };
}

// Miesiące do wyboru miesiąca faktury: pełne miesiące ze wszystkich przyjętych plików, te same,
// które liczy analiza zakresu (każda godzina miesiąca w obu seriach, w którymkolwiek pliku), bez
// powtórzeń, od najnowszego. `odRoku` i `doRoku` ograniczają listę do lat, które strona pozwala
// wybrać także w listach miesiąca i roku, żeby wybór z tej listy dało się zawsze tam przenieść.
// Bez analizy (brak przyjętych plików) lista jest pusta.
export function miesiaceFaktury(analiza, { odRoku = -Infinity, doRoku = Infinity } = {}) {
  const wynik = new Map();
  for (const { rok, miesiac } of analiza?.miesiacePelne ?? []) {
    if (rok < odRoku || rok > doRoku) continue;
    const wartosc = tekstMiesiaca({ rok, miesiac });
    wynik.set(wartosc, { rok, miesiac, wartosc });
  }
  return [...wynik.values()].sort((a, b) => (a.wartosc < b.wartosc ? 1 : a.wartosc > b.wartosc ? -1 : 0));
}

// Czy okres od `od` do `do` (doby) mieści się w całości w pełnych dobach plików.
export function okresWPelnychDobach(analiza, od, doDnia) {
  for (let d = numerDnia(od); d <= numerDnia(doDnia); d++) if (!analiza.pelneDoby.has(d)) return false;
  return true;
}
