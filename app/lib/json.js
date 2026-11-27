// Zapis JSON do plików w ZIP-ie: klucze w kolejności wstawiania, wcięcie 2 spacje, LF na końcu.
// Dozwolone są tylko tekst, wartości logiczne, liczby całkowite, listy i obiekty. Liczba
// niecałkowita albo null to błąd programu: kwoty i ceny muszą być tekstem, a pole puste
// po prostu nie ma klucza.

function sprawdz(wartosc, sciezka) {
  if (typeof wartosc === "string" || typeof wartosc === "boolean") return;
  if (typeof wartosc === "number") {
    if (!Number.isSafeInteger(wartosc)) throw new Error(`${sciezka}: dozwolone tylko liczby całkowite`);
    return;
  }
  if (Array.isArray(wartosc)) {
    wartosc.forEach((w, i) => sprawdz(w, `${sciezka}[${i}]`));
    return;
  }
  if (wartosc !== null && typeof wartosc === "object" && Object.getPrototypeOf(wartosc) === Object.prototype) {
    for (const [klucz, w] of Object.entries(wartosc)) sprawdz(w, `${sciezka}.${klucz}`);
    return;
  }
  throw new Error(`${sciezka}: niedozwolona wartość w JSON`);
}

// Obiekt JSON: nie null i nie lista.
export const obiekt = (w) => w !== null && typeof w === "object" && !Array.isArray(w);

export function doJson(obiekt) {
  sprawdz(obiekt, "$");
  return `${JSON.stringify(obiekt, null, 2)}\n`;
}
