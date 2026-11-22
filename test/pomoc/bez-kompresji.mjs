// Uruchamia funkcję tak, jakby przeglądarka nie miała kompresji deflate-raw albo kompresja się nie
// udała, i zawsze przywraca globalny CompressionStream. Warianty:
// - "brak": nie ma CompressionStream wcale;
// - "bez-deflate-raw": CompressionStream jest, ale odrzuca format "deflate-raw" (zna tylko
//   "gzip" i "deflate"), tak jak konstruktor w przeglądarce, która go nie obsługuje;
// - "blad-kompresji": konstruktor przyjmuje "deflate-raw", ale strumień zgłasza błąd przy danych
//   (od pliku o numerze `odPliku`, liczonym od 0), jak kompresja, która nie powiodła się w trakcie.
// Testy w jednym pliku idą po kolei, więc podmiana nie dotyka innych testów.

export async function bezKompresji(fn, wariant = "brak", { odPliku = 0 } = {}) {
  const opis = Object.getOwnPropertyDescriptor(globalThis, "CompressionStream");
  const Oryginal = globalThis.CompressionStream;
  try {
    if (wariant === "brak") delete globalThis.CompressionStream;
    else if (wariant === "bez-deflate-raw") {
      globalThis.CompressionStream = class extends Oryginal {
        constructor(format) {
          if (format === "deflate-raw") throw new TypeError("nieobsługiwany format");
          super(format);
        }
      };
    } else if (wariant === "blad-kompresji") {
      // Pierwsze wywołanie konstruktora sprawdza tylko, czy format jest znany; dalsze to kolejne
      // pliki ZIP-a.
      let utworzone = -1;
      globalThis.CompressionStream = class {
        constructor(format) {
          if (format !== "deflate-raw") throw new TypeError("nieobsługiwany format");
          const numer = utworzone++;
          const strumien = numer >= odPliku
            ? new TransformStream({ transform(_, kontroler) { kontroler.error(new Error("kompresja się nie powiodła")); } })
            : new Oryginal(format);
          this.readable = strumien.readable;
          this.writable = strumien.writable;
        }
      };
    } else throw new Error(`nieznany wariant: ${wariant}`);
    return await fn();
  } finally {
    Object.defineProperty(globalThis, "CompressionStream", opis);
  }
}
