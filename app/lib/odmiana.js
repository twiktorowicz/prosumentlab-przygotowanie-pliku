// Składanie tekstów dla klienta: formy liczby, wstawki, polski zapis dat i liczb.
// Same teksty są w app/teksty.js; tu jest tylko mechanika.

import { liczbaZCyfr } from "./kwoty.js";

export const WSTAWKI = new Set(["n", "m", "od", "do", "numer", "plik", "nazwa", "wiersz", "kolumna", "data", "pola", "kolumny", "wersja", "rozmiar", "adres"]);

// Pełna reguła polska: 1 miesiąc; 2–4 miesiące (także 22–24, 32–34…, ale nie 12–14);
// pozostałe: miesięcy.
export function formaLiczby(n) {
  if (n === 1) return "jeden";
  const d = n % 10;
  const s = n % 100;
  return d >= 2 && d <= 4 && (s < 12 || s > 14) ? "kilka" : "wiele";
}

// Wstawka kończąca się kropką (skrót „r.” w dacie) przed kropką kończącą zdanie: zostaje jedna
// kropka, jak w polskiej typografii („do stycznia 2026 r. To wystarczy”).
export function wypelnij(szablon, wstawki = {}) {
  return szablon.replace(/\{([^{}]*)\}(\.?)/g, (_, nazwa, kropka) => {
    if (!WSTAWKI.has(nazwa)) throw new Error(`nieznana wstawka {${nazwa}}`);
    if (!(nazwa in wstawki)) throw new Error(`brak wartości wstawki {${nazwa}}`);
    const wartosc = String(wstawki[nazwa]);
    return kropka && wartosc.endsWith(".") ? wartosc : wartosc + kropka;
  });
}

// Tekst o kluczu `klucz`; jeśli ma formy liczby, forma wynika z wstawki `n`.
export function tekst(TEKSTY, klucz, wstawki = {}) {
  const wpis = TEKSTY[klucz];
  if (wpis === undefined) throw new Error(`brak tekstu ${klucz}`);
  if (typeof wpis === "string") return wypelnij(wpis, wstawki);
  if (typeof wstawki.n !== "number") throw new Error(`tekst ${klucz} wymaga liczby {n}`);
  return wypelnij(wpis[formaLiczby(wstawki.n)], wstawki);
}

const dwie = (n) => String(n).padStart(2, "0");

// „19.11.2022 r.”, „1.07.2024 r.”
export function dataPolska({ rok, miesiac, dzien }) {
  return `${dzien}.${dwie(miesiac)}.${rok} r.`;
}

// Znacznik z pliku w polskim zapisie: "2026-10-25 03:00" -> „25.10.2026 r., 03:00”.
export function znacznikPolski(znacznik) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(znacznik);
  if (!m) throw new Error("oczekiwany znacznik RRRR-MM-DD GG:MM");
  return `${dataPolska({ rok: liczbaZCyfr(m[1]), miesiac: liczbaZCyfr(m[2]), dzien: liczbaZCyfr(m[3]) })}, ${m[4]}`;
}

// „stycznia 2025 r.”; nazwy miesięcy w dopełniaczu pochodzą z teksty.js.
export function miesiacZRokiem(rok, miesiac, nazwy) {
  return `${nazwy[miesiac - 1]} ${rok} r.`;
}

// Rozmiar zgłoszenia w bajtach do wyświetlenia. Poniżej 1 MB (1 048 576 bajtów) pełne KB
// (1024 bajty), od 1 MB megabajty z jednym miejscem po przecinku; zawsze w górę, żeby ZIP tuż
// ponad limitem wysyłki nie wyglądał na równy limitowi. Same liczby całkowite.
const KB = 1024;
const MB = 1024 * 1024;
export function rozmiarDoWyswietlenia(bajty) {
  if (bajty < MB) return `${Math.floor((bajty + KB - 1) / KB)} KB`;
  const dziesiate = Math.floor((bajty * 10 + MB - 1) / MB);
  return `${Math.floor(dziesiate / 10)},${dziesiate % 10} MB`;
}

// Wh jako pełne kWh do wyświetlenia (połówki w górę). Liczby do czterech cyfr bez odstępu,
// dłuższe z odstępem co trzy cyfry.
export function kwhDoWyswietlenia(wh) {
  const kwh = String(Math.floor((wh + 500) / 1000));
  if (kwh.length <= 4) return kwh;
  return kwh.replace(/\B(?=(\d{3})+$)/g, " ");
}
