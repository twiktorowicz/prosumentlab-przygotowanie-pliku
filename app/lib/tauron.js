// Plik godzinowy z eLicznika Taurona: rozpoznanie, sprawdzenia, usunięcie numerów i bezpiecznik.
//
// Dwa warianty nagłówka:
// - surowy, 7 kolumn: plik prosto z eLicznika, z numerem płatnika i numerem PPE;
// - bez numerów (bez_numerow), 5 kolumn: bez tych numerów; przechodzi bez zmian.
// Separator średnik, bez cudzysłowów, koniec linii CRLF albo LF, puste linie pomijane.
// Numer wiersza w komunikatach to numer linii w pliku (nagłówek zwykle ma numer 1).
//
// Narzędzie sprawdza tylko tyle, ile trzeba do podglądu, zakresu i bezpiecznika. Ciągłości
// serii, kolejności wierszy i godzin nieistniejących nie traktuje jako błędów: wpływają tylko
// na liczbę pełnych miesięcy. Pola wiersza przechodzą do wyniku bez zmian.
//
// Numery płatnika i PPE są trzymane tylko w zmiennej, do porównania plików w tym samym
// zgłoszeniu. Nie są nigdzie pokazywane, zapisywane ani przekształcane, także w skrót.

import { rozbierzZnacznik, godzinaZZnacznika, porzadek, dobaZmianyNaZimowy, numerDnia } from "./kalendarz.js";
import { liczbaZCyfr } from "./kwoty.js";
import { sprawdzBezpiecznik } from "./bezpiecznik.js";

export const NAGLOWEK_SUROWY =
  "Nr platnika;Nr punktu poboru energii;Rodzaj energii;Data i godzina;Strefa;Wartosc[kWh/kvar];Kompletnosc[%]";
export const NAGLOWEK_BEZ_NUMEROW = "Rodzaj energii;Data i godzina;Strefa;Wartosc[kWh/kvar];Kompletnosc[%]";
export const USUNIETE_KOLUMNY = ["Nr platnika", "Nr punktu poboru energii"];
export const LIMIT_WIERSZY = 50000;

// Dokładnie te cztery nazwy serii; każda inna to błąd. Słownik to Map, więc nazwy wbudowane
// w każdy obiekt JS (constructor, toString, __proto__ i podobne) nie są znaną serią. Dwie serie
// energii biernej przechodzą do wyniku bez zmian (z uwagą), bo eLicznik dołącza je, gdy klient
// zaznaczy te pola; każda ma własny klucz.
const SERIE = new Map([
  ["energia czynna oddana netto", "oddanie"],
  ["energia czynna pobrana netto", "pobor"],
  ["energia bierna indukcyjna pobrana", "bierna_indukcyjna"],
  ["energia bierna pojemnościowa pobrana", "bierna_pojemnosciowa"],
]);
const CZYNNE = new Set(["oddanie", "pobor"]);
// Etykieta strefy: pierwszy znak to litera; dalej litery, cyfry 0–9, myślniki i pojedyncze
// spacje (bez spacji na końcu); najwyżej 2 cyfry; od 2 do 40 znaków; najwyżej 8 różnych etykiet
// w pliku. Etykiety G13 z eLicznika to nazwy stref („Reszta dnia”); etykiet innych taryf nie
// znamy, więc reguła dopuszcza też „Strefa 1” albo „T1”. Numer, adres ani formuła arkusza
// („=SUMA”) nie przejdą.
const STREFA = /^\p{L}(?:[\p{L}0-9-]| (?! |$))*$/u;
const MAKS_CYFR_STREFY = 2;
const MAKS_ETYKIET = 8;
// Wartość w kWh w jednej godzinie: najwyżej trzy cyfry przed przecinkiem (do 999,999 kWh).
const WARTOSC = /^(\d{1,3})(?:,(\d{1,3}))?$/;
// Kompletność w procentach, od 0 do 100.
const KOMPLETNOSC = /^(\d{1,3})(?:,(\d{1,2}))?$/;

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

// Kompletność od 0 do 100: 100 tylko z zerami po przecinku.
function kompletnoscWZakresie(m) {
  const calosc = liczbaZCyfr(m[1]);
  return calosc < 100 || (calosc === 100 && !/[1-9]/.test(m[2] ?? ""));
}

const tenSamDzien = (a, b) => a.rok === b.rok && a.miesiac === b.miesiac && a.dzien === b.dzien;

// Godzina 2:00–3:00 w dobie zmiany czasu na zimowy występuje dwa razy (znacznik 03:00 dwa razy).
// Gdy seria ma oba wiersze, wystąpienia idą w kolejności z pliku: pierwszy wiersz to pierwsze
// wystąpienie, każdy następny drugie. Pojedynczy wiersz rozstrzyga sąsiedni wiersz tej samej
// serii: poprzedni 02:00 albo następny 03:00 oznacza pierwsze wystąpienie (czas letni), następny
// 04:00 drugie (czas zimowy). Bez takiego sąsiada: pierwsze wystąpienie.
// Jeden przebieg po serii: wiersze tej godziny zebrane według dnia, potem przypisane grupami.
function przypiszWystapienia(seria) {
  const grupy = new Map();
  seria.forEach((w, i) => {
    if (w.godzina !== 2 || !dobaZmianyNaZimowy(w.doba)) return;
    const dzien = numerDnia(w.doba);
    if (!grupy.has(dzien)) grupy.set(dzien, []);
    grupy.get(dzien).push(i);
  });
  for (const indeksy of grupy.values()) {
    if (indeksy.length >= 2) {
      indeksy.forEach((i, j) => {
        seria[i].wystapienie = j === 0 ? 1 : 2;
      });
      continue;
    }
    const i = indeksy[0];
    const w = seria[i];
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
  else if (naglowek === NAGLOWEK_BEZ_NUMEROW) wariant = "bez_numerow";
  else return nieznanyNaglowek(naglowek);

  const kolumn = wariant === "surowy" ? 7 : 5;
  const przesuniecie = kolumn - 5;
  const wyjscie = [{ tekst: NAGLOWEK_BEZ_NUMEROW, linia: i + 1 }];
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

    const seria = SERIE.get(nazwaSerii);
    if (!seria) return blad("blad_seria", nr);
    if (!CZYNNE.has(seria)) bierna = true;
    const z = rozbierzZnacznik(znacznik);
    if (!z.ok) return blad(z.kod === "nie_godzinowe" ? "blad_nie_godzinowe" : "blad_data", nr);
    const mw = WARTOSC.exec(wartosc);
    const mk = KOMPLETNOSC.exec(kompletnosc);
    if (!mw || !mk || !kompletnoscWZakresie(mk)) return blad("blad_wartosc", nr);

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
  // Kolumna pusta w całym pliku (klient wyczyścił ją sam): plik przechodzi, ale bez kompletu
  // numerów nie bierze udziału w porównaniu punktów poboru. Numer, który jest, idzie do
  // bezpiecznika. Kolumna pusta tylko w części wierszy to dwie różne wartości: blad_wiele_ppe.
  const platnik = [...platnicy][0] ?? "";
  const ppe = [...punkty][0] ?? "";
  const usunieteWartosci = [platnik, ppe].filter((w) => w !== "");
  const identyfikatory = platnik !== "" && ppe !== "" ? { platnik, ppe } : null;

  // W pliku wyjściowym znacznik jest drugim polem.
  const trafienie = sprawdzBezpiecznik(wyjscie, usunieteWartosci, { poleZnacznika: 1 });
  if (trafienie) return { ok: false, kod: "blad_bezpiecznik", wiersz: trafienie.linia, blokada: true };

  // Kolumna strefy po bezpieczniku: to, co wygląda na numer albo adres e-mail, blokuje z jego
  // komunikatem; reszta tekstu spoza dozwolonej postaci odrzuca plik.
  const etykiety = new Set();
  for (const w of wiersze) {
    const dlugosc = [...w.strefa].length;
    const cyfr = w.strefa.replace(/[^0-9]/g, "").length;
    if (!STREFA.test(w.strefa) || dlugosc < 2 || dlugosc > 40 || cyfr > MAKS_CYFR_STREFY) return blad("blad_strefa", w.linia);
    etykiety.add(w.strefa);
    if (etykiety.size > MAKS_ETYKIET) return blad("blad_strefa", w.linia);
  }

  for (const s of new Set(SERIE.values())) przypiszWystapienia(wiersze.filter((w) => w.seria === s));

  const czynne = wiersze.filter((w) => CZYNNE.has(w.seria));
  const uwagi = [];
  const niepelne = new Set(czynne.filter((w) => w.niepelna).map((w) => w.porzadek));
  if (niepelne.size > 0) uwagi.push({ kod: "UWAGA_KOMPLETNOSC", n: niepelne.size });
  if (bierna) uwagi.push({ kod: "UWAGA_BIERNA" });

  // Pierwsza i ostatnia godzina pliku tylko z serii energii czynnej, tak jak zakres.
  let pierwszy = czynne[0];
  let ostatni = czynne[0];
  for (const w of czynne) {
    if (w.porzadek < pierwszy.porzadek) pierwszy = w;
    if (w.porzadek > ostatni.porzadek) ostatni = w;
  }

  return {
    ok: true,
    wariant,
    wynik: wyjscie.map((w) => `${w.tekst}\n`).join(""),
    wiersze,
    identyfikatory,
    usunieteWartosci,
    usunieteKolumny: wariant === "surowy" ? [...USUNIETE_KOLUMNY] : [],
    wierszeDanych: wiersze.length,
    pierwszyZnacznik: pierwszy.znacznik,
    ostatniZnacznik: ostatni.znacznik,
    pierwszyPorzadek: pierwszy.porzadek,
    ostatniPorzadek: ostatni.porzadek,
    uwagi,
  };
}
