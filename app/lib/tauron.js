// Plik godzinowy z eLicznika Taurona: rozpoznanie, sprawdzenia, usunięcie numerów i bezpiecznik.
//
// Dwa warianty nagłówka:
// - surowy, 7 kolumn: plik prosto z eLicznika, z numerem płatnika i numerem PPE;
// - zanonimizowany, 5 kolumn: bez tych numerów; przechodzi bez zmian.
// Separator średnik, bez cudzysłowów, koniec linii CRLF albo LF, puste linie pomijane.
// Numer wiersza w komunikatach to numer linii w pliku (nagłówek zwykle ma numer 1).
//
// Narzędzie sprawdza tylko tyle, ile trzeba do podglądu, zakresu i bezpiecznika. Ciągłości
// serii, kolejności wierszy i godzin nieistniejących nie traktuje jako błędów: wpływają tylko
// na liczbę pełnych miesięcy. Pola wiersza przechodzą do wyniku bez zmian.
//
// Numery płatnika i PPE są trzymane tylko w zmiennej, do porównania plików w tym samym
// zgłoszeniu. Nie są nigdzie pokazywane, zapisywane ani przekształcane, także w skrót.

import { rozbierzZnacznik, godzinaZZnacznika, porzadek, dobaZmianyNaZimowy } from "./kalendarz.js";
import { liczbaZCyfr } from "./kwoty.js";
import { sprawdzBezpiecznik } from "./bezpiecznik.js";

export const NAGLOWEK_SUROWY =
  "Nr platnika;Nr punktu poboru energii;Rodzaj energii;Data i godzina;Strefa;Wartosc[kWh/kvar];Kompletnosc[%]";
export const NAGLOWEK_ZANONIMIZOWANY = "Rodzaj energii;Data i godzina;Strefa;Wartosc[kWh/kvar];Kompletnosc[%]";
export const USUNIETE_KOLUMNY = ["Nr platnika", "Nr punktu poboru energii"];
export const LIMIT_WIERSZY = 50000;

const SERIE = { "energia czynna oddana netto": "oddanie", "energia czynna pobrana netto": "pobor" };
const WARTOSC = /^(\d{1,9})(?:,(\d{1,3}))?$/;
const KOMPLETNOSC = /^(\d{1,3})(?:,\d{1,2})?$/;

const blad = (kod, wiersz) => (wiersz === undefined ? { ok: false, kod } : { ok: false, kod, wiersz });

// Plik tekstowy bez żadnego z dwóch nagłówków: inny raport z eLicznika, jeśli pierwsza linia
// ma średniki i nazwy kolumn eLicznika; w pozostałych przypadkach plik innego operatora.
function nieznanyNaglowek(linia) {
  if (linia.includes(";") && linia.includes("Rodzaj energii") && linia.includes("Wartosc[kWh/kvar]")) {
    return blad("blad_naglowek");
  }
  return blad("blad_inny_operator");
}

// Wartość w kWh z trzema miejscami (albo mniej) jako liczba całkowita Wh: "2,141" -> 2141.
function naWh(m) {
  return liczbaZCyfr(m[1]) * 1000 + (m[2] ? liczbaZCyfr(m[2].padEnd(3, "0")) : 0);
}

const tenSamDzien = (a, b) => a.rok === b.rok && a.miesiac === b.miesiac && a.dzien === b.dzien;

// Godzina 2:00–3:00 w dobie zmiany czasu na zimowy występuje dwa razy (znacznik 03:00 dwa razy).
// Gdy seria ma oba wiersze, wystąpienia idą w kolejności z pliku. Pojedynczy wiersz rozstrzyga
// sąsiedni wiersz tej samej serii: poprzedni 02:00 albo następny 03:00 oznacza pierwsze
// wystąpienie (czas letni), następny 04:00 drugie (czas zimowy). Bez takiego sąsiada:
// pierwsze wystąpienie.
function przypiszWystapienia(seria) {
  const powtorzona = (w) => w.godzina === 2 && dobaZmianyNaZimowy(w.doba);
  for (let i = 0; i < seria.length; i++) {
    const w = seria[i];
    if (!powtorzona(w)) continue;
    const grupa = seria.filter((x) => powtorzona(x) && tenSamDzien(x.doba, w.doba));
    if (grupa.length >= 2) {
      w.wystapienie = grupa[0] === w ? 1 : 2;
      continue;
    }
    const poprzedni = seria[i - 1];
    const nastepny = seria[i + 1];
    if (poprzedni && tenSamDzien(poprzedni.doba, w.doba) && poprzedni.godzina === 1) w.wystapienie = 1;
    else if (nastepny && tenSamDzien(nastepny.doba, w.doba) && nastepny.godzina === 3) w.wystapienie = 2;
    else w.wystapienie = 1;
  }
  for (const w of seria) w.porzadek = porzadek(w.doba, w.godzina, w.wystapienie);
}

export function czytajTauron(tekst) {
  const linie = tekst.split(/\r?\n/);
  let i = linie.findIndex((l) => l.trim() !== "");
  // Pusty plik (zero bajtów albo same puste linie) to plik, którego narzędzie nie odczytało.
  if (i < 0) return blad("blad_nieznany");
  const naglowek = linie[i].replace(/^\ufeff/, "");
  let wariant;
  if (naglowek === NAGLOWEK_SUROWY) wariant = "surowy";
  else if (naglowek === NAGLOWEK_ZANONIMIZOWANY) wariant = "zanonimizowany";
  else return nieznanyNaglowek(naglowek);

  const kolumn = wariant === "surowy" ? 7 : 5;
  const przesuniecie = kolumn - 5;
  const wyjscie = [{ tekst: NAGLOWEK_ZANONIMIZOWANY, linia: i + 1 }];
  const wiersze = [];
  const platnicy = new Set();
  const punkty = new Set();
  let bierna = false;

  for (i += 1; i < linie.length; i++) {
    const linia = linie[i];
    if (linia.trim() === "") continue;
    const nr = i + 1;
    const pola = linia.split(";");
    if (pola.length !== kolumn) return blad("blad_wiersz", nr);
    if (wiersze.length >= LIMIT_WIERSZY) return blad("blad_za_duzy");
    const [nazwaSerii, znacznik, strefa, wartosc, kompletnosc] = pola.slice(przesuniecie);

    let seria = SERIE[nazwaSerii];
    if (!seria) {
      if (!nazwaSerii.startsWith("energia bierna")) return blad("blad_seria", nr);
      seria = "bierna";
      bierna = true;
    }
    const z = rozbierzZnacznik(znacznik);
    if (!z.ok) return blad(z.kod === "nie_godzinowe" ? "blad_nie_godzinowe" : "blad_data", nr);
    const mw = WARTOSC.exec(wartosc);
    const mk = KOMPLETNOSC.exec(kompletnosc);
    if (!mw || !mk) return blad("blad_wartosc", nr);

    if (wariant === "surowy") {
      platnicy.add(pola[0]);
      punkty.add(pola[1]);
    }
    const { doba, godzina } = godzinaZZnacznika(z);
    wiersze.push({
      seria, znacznik, strefa, kompletnosc, doba, godzina, wystapienie: 1,
      wh: naWh(mw),
      niepelna: liczbaZCyfr(mk[1]) < 100,
      linia: nr,
    });
    wyjscie.push({ tekst: pola.slice(przesuniecie).join(";"), linia: nr });
  }

  if (!wiersze.some((w) => w.seria === "oddanie") || !wiersze.some((w) => w.seria === "pobor")) {
    return blad("blad_brak_serii");
  }
  if (platnicy.size > 1 || punkty.size > 1) return { ok: false, kod: "blad_wiele_ppe", blokada: true };
  const identyfikatory = wariant === "surowy" ? { platnik: [...platnicy][0], ppe: [...punkty][0] } : null;

  // W pliku wyjściowym znacznik jest drugim polem.
  const trafienie = sprawdzBezpiecznik(wyjscie, identyfikatory ? [identyfikatory.platnik, identyfikatory.ppe] : [], { poleZnacznika: 1 });
  if (trafienie) return { ok: false, kod: "blad_bezpiecznik", wiersz: trafienie.linia, blokada: true };

  for (const s of ["oddanie", "pobor", "bierna"]) przypiszWystapienia(wiersze.filter((w) => w.seria === s));

  const uwagi = [];
  const niepelne = new Set(wiersze.filter((w) => w.seria !== "bierna" && w.niepelna).map((w) => w.porzadek));
  if (niepelne.size > 0) uwagi.push({ kod: "UWAGA_KOMPLETNOSC", n: niepelne.size });
  if (bierna) uwagi.push({ kod: "UWAGA_BIERNA" });

  let pierwszy = wiersze[0];
  let ostatni = wiersze[0];
  for (const w of wiersze) {
    if (w.porzadek < pierwszy.porzadek) pierwszy = w;
    if (w.porzadek > ostatni.porzadek) ostatni = w;
  }

  return {
    ok: true,
    wariant,
    wynik: wyjscie.map((w) => `${w.tekst}\n`).join(""),
    wiersze,
    identyfikatory,
    usunieteKolumny: wariant === "surowy" ? [...USUNIETE_KOLUMNY] : [],
    wierszeDanych: wiersze.length,
    pierwszyZnacznik: pierwszy.znacznik,
    ostatniZnacznik: ostatni.znacznik,
    pierwszyPorzadek: pierwszy.porzadek,
    ostatniPorzadek: ostatni.porzadek,
    uwagi,
  };
}
