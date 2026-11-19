// Bezpiecznik identyfikatorów: ostatnie sprawdzenie pliku wyjściowego przed dopuszczeniem go
// do ZIP-a. Sprawdza każdy wiersz wyniku, łącznie z nagłówkiem. W wyniku nie może być:
// 1. żadnej z usuniętych wartości (numer płatnika, numer PPE) o długości co najmniej 6 znaków,
//    także samych cyfr takiej wartości: kolumna PPE ma postać "PPE:" i 18 cyfr, a do innej
//    kolumny mogłyby przeciec same cyfry;
// 2. ciągu 12 i więcej cyfr;
// 3. słowa „PPE” jako całego słowa, bez względu na wielkość liter;
// 4. kodu PPE w standardzie GS1 (590 i 15 cyfr), także z pojedynczymi spacjami albo myślnikami
//    między cyframi;
// 5. adresu e-mail.
// Wynik podaje tylko numer wiersza, nigdy treść.

const REGULY = [
  /\d{12,}/,
  /(?<![\p{L}\p{N}_])PPE(?![\p{L}\p{N}_])/iu,
  /590(?:[ -]?\d){15}/,
  /[^\s@;]+@[^\s@;]+\.[^\s@;]+/,
];

// `linie`: [{tekst, linia}], gdzie `linia` to numer linii w pliku wejściowym.
export function sprawdzBezpiecznik(linie, usunieteWartosci) {
  const szukane = new Set();
  for (const w of usunieteWartosci) {
    const cyfry = w.replace(/\D/g, "");
    if (w.length >= 6) szukane.add(w);
    if (cyfry.length >= 6) szukane.add(cyfry);
  }
  const lista = [...szukane];
  for (const { tekst, linia } of linie) {
    if (lista.some((w) => tekst.includes(w)) || REGULY.some((r) => r.test(tekst))) return { linia };
  }
  return null;
}
