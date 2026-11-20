// Bezpiecznik identyfikatorów: ostatnie sprawdzenie pliku wyjściowego przed dopuszczeniem go
// do ZIP-a. Sprawdza każdy wiersz wyniku, łącznie z nagłówkiem. W wyniku nie może być:
// 1. żadnej z usuniętych wartości (numer płatnika, numer PPE) o długości co najmniej 6 znaków,
//    także samych cyfr takiej wartości: kolumna PPE ma postać "PPE:" i 18 cyfr, a do innej
//    kolumny mogłyby przeciec same cyfry;
// 2. ciągu 12 i więcej cyfr;
// 3. słowa „PPE” jako całego słowa, bez względu na wielkość liter;
// 4. kodu PPE w standardzie GS1 (590 i 15 cyfr), także z pojedynczymi spacjami albo myślnikami
//    między cyframi;
// 5. adresu e-mail;
// 6. w żadnym polu poza polem znacznika, po usunięciu wszystkiego, co nie jest cyfrą: cyfr
//    żadnej z usuniętych wartości (od 6 cyfr) ani 12 i więcej cyfr z rzędu. Łapie numer zapisany
//    z odstępami, kropkami albo ukośnikami. Pole znacznika jest pominięte, bo data i godzina dają
//    12 cyfr i mogłyby przypadkiem zawierać numer.
// Wynik podaje tylko numer wiersza, nigdy treść.
// Pliki JSON zgłoszenia (pola wpisane ręcznie) przechodzą reguły 1–5 bez reguły 6 (opcja
// `regula6: false`): reguła 6 jest dla kolumn pliku z licznika, a w JSON-ie dwie daty w jednej
// linii dałyby 16 cyfr.

const REGULY = [
  /\d{12,}/,
  /(?<![\p{L}\p{N}_])PPE(?![\p{L}\p{N}_])/iu,
  /590(?:[ -]?\d){15}/,
  /[^\s@;]+@[^\s@;]+\.[^\s@;]+/,
];

// `linie`: [{tekst, linia}], gdzie `linia` to numer linii w pliku wejściowym.
// `poleZnacznika`: numer pola (od 0, separator średnik) pomijanego w regule 6.
// `regula6`: false wyłącza regułę 6.
export function sprawdzBezpiecznik(linie, usunieteWartosci, { poleZnacznika = -1, regula6: zRegula6 = true } = {}) {
  const szukane = new Set();
  const cyfryUsunietych = new Set();
  for (const w of usunieteWartosci) {
    const cyfry = w.replace(/\D/g, "");
    if (w.length >= 6) szukane.add(w);
    if (cyfry.length >= 6) {
      szukane.add(cyfry);
      cyfryUsunietych.add(cyfry);
    }
  }
  const lista = [...szukane];
  const listaCyfr = [...cyfryUsunietych];
  const regula6 = (tekst) =>
    tekst.split(";").some((pole, i) => {
      if (i === poleZnacznika) return false;
      const cyfry = pole.replace(/\D/g, "");
      return cyfry.length >= 12 || listaCyfr.some((w) => cyfry.includes(w));
    });
  for (const { tekst, linia } of linie) {
    if (lista.some((w) => tekst.includes(w)) || REGULY.some((r) => r.test(tekst)) || (zRegula6 && regula6(tekst))) return { linia };
  }
  return null;
}
