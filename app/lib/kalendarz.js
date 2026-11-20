// Kalendarz bez zegara przeglądarki. Wynik nie może zależeć od strefy czasowej urządzenia:
// - znacznik "RRRR-MM-DD GG:MM" jest rozbierany z tekstu na części, bez obiektu Date;
// - znacznik oznacza koniec godziny w czasie lokalnym; godzina należy do doby wskazanej przez
//   jej początek, a 00:00 i 24:00 kończą ostatnią godzinę doby poprzedniej;
// - doba ma 24 godziny, poza ostatnią niedzielą marca (23, bez godziny 2:00–3:00) i ostatnią
//   niedzielą października (25, godzina 2:00–3:00 dwa razy: wystąpienie 1 i 2). To reguła UE
//   obowiązująca od 1996 r.; jej zniesienie wymaga nowego wydania narzędzia;
// - dzień tygodnia i numer dnia liczone z Date.UTC, które nie zależy od strefy czasowej.

import { liczbaZCyfr } from "./kwoty.js";

const MS_DOBY = 24 * 60 * 60 * 1000;

// Lata, które narzędzie przyjmuje w znacznikach pliku i w datach z formularza. Poza nimi data
// jest błędem: eLicznik nie ma danych sprzed 2010 r., a górna granica ogranicza koszt analizy
// zakresu (każdy miesiąc między pierwszą a ostatnią godziną jest liczony).
export const ROK_MIN = 2010;
export const ROK_MAKS = 2099;
export const rokWZakresie = (rok) => rok >= ROK_MIN && rok <= ROK_MAKS;

export function przestepny(rok) {
  return (rok % 4 === 0 && rok % 100 !== 0) || rok % 400 === 0;
}

export function dniMiesiaca(rok, miesiac) {
  if (miesiac === 2) return przestepny(rok) ? 29 : 28;
  return [4, 6, 9, 11].includes(miesiac) ? 30 : 31;
}

export function poprawnaDoba(rok, miesiac, dzien) {
  return rok >= 1970 && rok <= 9999 && miesiac >= 1 && miesiac <= 12 && dzien >= 1 && dzien <= dniMiesiaca(rok, miesiac);
}

// Liczba dni od 1.01.1970.
export function numerDnia({ rok, miesiac, dzien }) {
  return Date.UTC(rok, miesiac - 1, dzien) / MS_DOBY;
}

// Doba z numeru dnia, na liczbach całkowitych (algorytm „civil from days”).
export function dobaZNumeru(n) {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const dzien = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const miesiac = mp < 10 ? mp + 3 : mp - 9;
  return { rok: yoe + era * 400 + (miesiac <= 2 ? 1 : 0), miesiac, dzien };
}

// 0 = niedziela; 1.01.1970 był czwartkiem.
export function dzienTygodnia(doba) {
  return (((numerDnia(doba) + 4) % 7) + 7) % 7;
}

export function ostatniaNiedziela(rok, miesiac) {
  const ostatni = dniMiesiaca(rok, miesiac);
  return ostatni - dzienTygodnia({ rok, miesiac, dzien: ostatni });
}

export function rozbierzZnacznik(tekst) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(tekst);
  if (!m) return { ok: false, kod: "data" };
  const [rok, miesiac, dzien, godzina] = [m[1], m[2], m[3], m[4]].map(liczbaZCyfr);
  if (!rokWZakresie(rok) || !poprawnaDoba(rok, miesiac, dzien) || godzina > 24) return { ok: false, kod: "data" };
  if (m[5] !== "00") return { ok: false, kod: "nie_godzinowe" };
  return { ok: true, rok, miesiac, dzien, godzina };
}

// Godzina, którą kończy znacznik: doba i godzina początku (0–23).
export function godzinaZZnacznika({ rok, miesiac, dzien, godzina }) {
  const doba = { rok, miesiac, dzien };
  if (godzina === 0) return { doba: dobaZNumeru(numerDnia(doba) - 1), godzina: 23 };
  return { doba, godzina: godzina - 1 };
}

const zmianaNaLetni = ({ rok, miesiac, dzien }) => miesiac === 3 && dzien === ostatniaNiedziela(rok, 3);
const zmianaNaZimowy = ({ rok, miesiac, dzien }) => miesiac === 10 && dzien === ostatniaNiedziela(rok, 10);

export function dobaZmianyNaZimowy(doba) {
  return zmianaNaZimowy(doba);
}

// Godziny doby jako pary (godzina początku, wystąpienie), w kolejności.
export function godzinyDoby(doba) {
  const wynik = [];
  for (let godzina = 0; godzina < 24; godzina++) {
    if (godzina === 2 && zmianaNaLetni(doba)) continue;
    wynik.push({ godzina, wystapienie: 1 });
    if (godzina === 2 && zmianaNaZimowy(doba)) wynik.push({ godzina, wystapienie: 2 });
  }
  return wynik;
}

export function istniejeGodzina(doba, godzina, wystapienie) {
  if (godzina === 2 && zmianaNaLetni(doba)) return false;
  if (wystapienie === 2) return godzina === 2 && zmianaNaZimowy(doba);
  return wystapienie === 1 && godzina >= 0 && godzina <= 23;
}

export function godzinMiesiaca(rok, miesiac) {
  let suma = 0;
  for (let dzien = 1; dzien <= dniMiesiaca(rok, miesiac); dzien++) suma += godzinyDoby({ rok, miesiac, dzien }).length;
  return suma;
}

// Liczba porządkowa godziny: rośnie z czasem, także w dobie 25-godzinnej. Służy jako klucz
// godziny w mapach i do wyznaczania luk.
export function porzadek(doba, godzina, wystapienie) {
  return numerDnia(doba) * 64 + godzina * 2 + (wystapienie - 1);
}

export function zPorzadku(p) {
  const n = Math.floor(p / 64);
  const reszta = p - n * 64;
  return { doba: dobaZNumeru(n), godzina: Math.floor(reszta / 2), wystapienie: (reszta % 2) + 1 };
}

// Kolejne miesiące jako liczby rok * 12 + (miesiąc - 1).
export const numerMiesiaca = (rok, miesiac) => rok * 12 + (miesiac - 1);
export const miesiacZNumeru = (n) => ({ rok: Math.floor(n / 12), miesiac: (n % 12) + 1 });
