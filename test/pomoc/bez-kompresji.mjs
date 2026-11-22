// Uruchamia funkcję tak, jakby przeglądarka nie miała kompresji deflate-raw, i zawsze przywraca
// globalny CompressionStream. Dwa warianty starszych przeglądarek:
// - "brak": nie ma CompressionStream wcale;
// - "bez-deflate-raw": CompressionStream jest, ale odrzuca format "deflate-raw" (zna tylko
//   "gzip" i "deflate"), tak jak konstruktor w przeglądarce, która go nie obsługuje.
// Testy w jednym pliku idą po kolei, więc podmiana nie dotyka innych testów.

export async function bezKompresji(fn, wariant = "brak") {
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
    } else throw new Error(`nieznany wariant: ${wariant}`);
    return await fn();
  } finally {
    Object.defineProperty(globalThis, "CompressionStream", opis);
  }
}
