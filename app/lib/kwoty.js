// Odczyt liczb wpisanych przez klienta. Działa wyłącznie na tekście: kwoty i ceny zostają
// tekstem dziesiętnym z kropką, energia i grosze są liczbami całkowitymi. Bez liczb
// zmiennoprzecinkowych, więc nie ma błędów zaokrągleń.
//
// Zasady wspólne:
// - spacje na początku i końcu są pomijane;
// - spacja (także twarda i wąska twarda) może rozdzielać tylko grupy po trzy cyfry w części
//   całkowitej: „1 234,5” tak, „12 34” nie;
// - przecinek albo kropka dziesiętna, dokładnie jeden znak, po nim co najmniej jedna cyfra;
// - bez znaku minus i plus.

const SPACJA = "[ \\u00a0\\u202f\\u2007]";
const LICZBA = new RegExp(`^(\\d+|\\d{1,3}(?:${SPACJA}\\d{3})+)(?:[.,](\\d+))?$`);
const SPACJE = new RegExp(SPACJA, "g");

// Liczba całkowita z samych cyfr, liczona cyfra po cyfrze. Zwraca null dla innego tekstu.
export function liczbaZCyfr(tekst) {
  if (typeof tekst !== "string" || !/^\d{1,15}$/.test(tekst)) return null;
  let wynik = 0;
  for (let i = 0; i < tekst.length; i++) wynik = wynik * 10 + (tekst.charCodeAt(i) - 48);
  return wynik;
}

const blad = { ok: false };

function rozbierz(tekst) {
  if (typeof tekst !== "string") return null;
  const m = LICZBA.exec(tekst.trim());
  if (!m) return null;
  const calkowite = m[1].replace(SPACJE, "").replace(/^0+(?=\d)/, "");
  return { calkowite, ulamek: m[2] };
}

// Kwota w złotych: od 0 do 2 miejsc po przecinku, zapis uzupełniony do dwóch miejsc.
// „12,34” -> "12.34", „10” -> "10.00", „1 234,5” -> "1234.50"; 3 i więcej miejsc to błąd.
export function czytajKwote(tekst) {
  return czytajDziesietna(tekst, { miejsc: 2 });
}

// Cena za kWh: od 2 do 6 miejsc po przecinku, zapis bez dopisywania zer.
export function czytajCene(tekst) {
  const c = rozbierz(tekst);
  if (!c || c.ulamek === undefined || c.ulamek.length < 2 || c.ulamek.length > 6) return blad;
  return { ok: true, wartosc: `${c.calkowite}.${c.ulamek}` };
}

// Energia w kWh: liczba całkowita.
export function czytajEnergie(tekst) {
  const c = rozbierz(tekst);
  if (!c || c.ulamek !== undefined) return blad;
  const wartosc = liczbaZCyfr(c.calkowite);
  return wartosc === null ? blad : { ok: true, wartosc };
}

// Liczba dziesiętna z najwyżej `miejsc` miejscami po przecinku, zapis uzupełniony do `miejsc`.
// `calkowitych` ogranicza liczbę cyfr przed przecinkiem, `dodatnia` odrzuca zero.
export function czytajDziesietna(tekst, { miejsc, calkowitych = 15, dodatnia = false }) {
  const c = rozbierz(tekst);
  if (!c) return blad;
  const ulamek = c.ulamek ?? "";
  if (ulamek.length > miejsc || c.calkowite.length > calkowitych) return blad;
  const uzupelniony = ulamek.padEnd(miejsc, "0");
  if (dodatnia && /^0+$/.test(c.calkowite + uzupelniony)) return blad;
  return { ok: true, wartosc: miejsc > 0 ? `${c.calkowite}.${uzupelniony}` : c.calkowite };
}

// Kwota zapisana jako "1234.50" (albo "-12.34") w groszach.
export function naGrosze(kwota) {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(kwota);
  if (!m) throw new Error("oczekiwana kwota z dwoma miejscami po przecinku");
  const grosze = liczbaZCyfr(m[2]) * 100 + liczbaZCyfr(m[3]);
  return m[1] ? -grosze : grosze;
}

// Pole na dowolny tekst (nazwa sprzedawcy, taryfy, opłaty): najwyżej 60 znaków, bez „@”.
// Ciągi cyfr liczone po pominięciu spacji, myślników, kropek i ukośników między cyframi:
// 5 i więcej cyfr to błąd (kod pocztowy, telefon, numer klienta), 4 cyfry tylko jako rok
// 2000–2099, krótsze ciągi są dozwolone.
export function czytajTekstWolny(tekst) {
  if (typeof tekst !== "string") return blad;
  const t = tekst.trim();
  if ([...t].length > 60 || t.includes("@")) return blad;
  for (const ciag of t.matchAll(/\d(?:[  \-./]*\d)*/g)) {
    const cyfry = ciag[0].replace(/\D/g, "");
    if (cyfry.length >= 5) return blad;
    if (cyfry.length === 4) {
      const rok = liczbaZCyfr(cyfry);
      if (rok < 2000 || rok > 2099) return blad;
    }
  }
  return { ok: true, wartosc: t };
}
