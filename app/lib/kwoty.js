// Odczyt liczb wpisanych przez klienta. Działa wyłącznie na tekście: kwoty i ceny zostają
// tekstem dziesiętnym z kropką. Bez liczb
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

// Kwota w złotych, zapis z dwoma miejscami po przecinku: „12,34” -> "12.34", „10” -> "10.00",
// „1 234,5” -> "1234.50". Najwyżej 4 cyfry przed przecinkiem: miesięczna opłata nie przekracza
// 9999,99 zł, a w polu liczbowym nie zmieści się numer klienta ani telefon. Dalsze miejsca
// po przecinku są dozwolone tylko jako zera, bo opłaty stałe stoją na fakturze w kolumnie
// „Cena netto (zł)” z pięcioma miejscami: „12,34000” -> "12.34". Cyfra inna niż zero na trzecim
// i dalszym miejscu to błąd („12,341”), bo nie wiadomo, czy to pomyłka.
export function czytajKwote(tekst) {
  return czytajDziesietna(tekst, { miejsc: 2, calkowitych: 4, zeraNaKoncu: true });
}

// Cena za kWh: od 0 do 6 miejsc po przecinku, zapis z co najmniej dwoma miejscami („1” -> "1.00",
// „0,6” -> "0.60", „0,51234” -> "0.51234"). Cena od 10 zł/kWh w górę (część całkowita bez zer
// wiodących ma więcej niż jedną cyfrę) to prawie na pewno cena w groszach: osobny kod błędu.
export function czytajCene(tekst) {
  const c = rozbierz(tekst);
  const ulamek = c?.ulamek ?? "";
  if (!c || ulamek.length > 6) return blad;
  if (c.calkowite.length > 1) return { ok: false, kod: "faktura_cena_grosze" };
  return { ok: true, wartosc: `${c.calkowite}.${ulamek.padEnd(2, "0")}` };
}

// Liczba dziesiętna z najwyżej `miejsc` miejscami po przecinku, zapis uzupełniony do `miejsc`.
// `calkowitych` ogranicza liczbę cyfr przed przecinkiem, `dodatnia` odrzuca zero,
// `zeraNaKoncu` pozwala na dalsze miejsca, jeśli są samymi zerami.
export function czytajDziesietna(tekst, { miejsc, calkowitych = 15, dodatnia = false, zeraNaKoncu = false }) {
  const c = rozbierz(tekst);
  if (!c) return blad;
  let ulamek = c.ulamek ?? "";
  if (zeraNaKoncu && ulamek.length > miejsc && /^0+$/.test(ulamek.slice(miejsc))) ulamek = ulamek.slice(0, miejsc);
  if (ulamek.length > miejsc || c.calkowite.length > calkowitych) return blad;
  const uzupelniony = ulamek.padEnd(miejsc, "0");
  if (dodatnia && /^0+$/.test(c.calkowite + uzupelniony)) return blad;
  return { ok: true, wartosc: miejsc > 0 ? `${c.calkowite}.${uzupelniony}` : c.calkowite };
}

// Liczba wpisana od przecinka albo kropki („,3”) z zerem na początku („0,3”). Tylko dla strony:
// po wyjściu z pola z liczbą wpisuje w pole tę postać, a klient ją widzi. Funkcje odczytu wyżej
// zostają ścisłe i „,3” dalej odrzucają. Inny tekst (także pusty i z niewidocznymi znakami)
// zostaje bez zmian, co do znaku.
export function zeroPrzedPrzecinkiem(tekst) {
  if (typeof tekst !== "string") return tekst;
  const t = tekst.trim();
  return /^[.,]\d+$/.test(t) ? `0${t}` : tekst;
}

// Pole na dowolny tekst (nazwa sprzedawcy, taryfy, opłaty): najwyżej 60 znaków. Dozwolone są
// tylko litery, cyfry ASCII, spacja i znaki . , - / ( ) + & ' %. Lista dozwolonych zamiast
// zakazanych zamyka drogę numerom z niewidocznymi znakami, cyframi pełnej szerokości albo
// znakami zmiany kierunku pisma. Tekst jest najpierw składany (NFC), więc litera zapisana jako
// litera i znak łączący też przechodzi.
// Cyfry: grupa to cyfry stojące obok siebie. Najwyżej dwie grupy czterocyfrowe o wartości
// 2000–2099 liczą się jako lata („Taryfa G12 2026”, „G12w 2025/2026”) i są pomijane. Poza nimi
// całe pole ma najwyżej 4 cyfry, bez względu na to, co je rozdziela: telefon, kod pocztowy albo
// numer klienta zapisany z przecinkami czy nawiasami też przekroczy limit.
// Tekst dłuższy niż 120 jednostek UTF-16 (60 liter zapisanych jako litera i znak łączący) jest
// odrzucany od razu, przed składaniem i liczeniem znaków.
const MAKS_LAT = 2;
const MAKS_CYFR = 4;
const MAKS_JEDNOSTEK = 120;
export function czytajTekstWolny(tekst) {
  if (typeof tekst !== "string" || tekst.length > MAKS_JEDNOSTEK) return blad;
  const t = tekst.normalize("NFC").replace(/^ +| +$/g, "");
  if ([...t].length > 60 || !/^[\p{L}0-9 .,\-/()+&'%]*$/u.test(t)) return blad;
  let lata = 0;
  let cyfr = 0;
  for (const grupa of t.match(/[0-9]+/g) ?? []) {
    const rok = grupa.length === 4 ? liczbaZCyfr(grupa) : null;
    if (lata < MAKS_LAT && rok !== null && rok >= 2000 && rok <= 2099) lata += 1;
    else cyfr += grupa.length;
  }
  if (cyfr > MAKS_CYFR) return blad;
  return { ok: true, wartosc: t };
}
