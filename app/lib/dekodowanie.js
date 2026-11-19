// Rozpoznanie rodzaju pliku i dekodowanie tekstu.
// Kolejność:
// 1. plik większy niż 10 MB: odrzucony;
// 2. znacznik BOM UTF-16 (LE albo BE): odrzucony przed dekodowaniem, bo Windows-1250 przyjąłby
//    prawie każdy ciąg bajtów i dał nieczytelny tekst;
// 3. arkusz rozpoznany po pierwszych bajtach: „PK” (.xlsx, .ods) albo D0 CF 11 E0 (.xls);
// 4. bajt zerowy w pierwszych 8 KB: inny plik binarny;
// 5. ścisłe dekodowanie UTF-8 (z obsługą BOM), a gdy się nie uda, Windows-1250.

export const LIMIT_BAJTOW = 10 * 1024 * 1024;

const zaczynaSie = (bajty, poczatek) => poczatek.every((b, i) => bajty[i] === b);

export function dekoduj(bajty) {
  if (bajty.length > LIMIT_BAJTOW) return { ok: false, kod: "blad_za_duzy" };
  if (zaczynaSie(bajty, [0xff, 0xfe]) || zaczynaSie(bajty, [0xfe, 0xff])) return { ok: false, kod: "blad_kodowanie" };
  if (zaczynaSie(bajty, [0x50, 0x4b]) || zaczynaSie(bajty, [0xd0, 0xcf, 0x11, 0xe0])) return { ok: false, kod: "blad_arkusz" };
  if (bajty.subarray(0, 8192).includes(0)) return { ok: false, kod: "blad_nieznany" };

  const bom = zaczynaSie(bajty, [0xef, 0xbb, 0xbf]);
  try {
    // ignoreBOM: false (domyślnie) usuwa znacznik BOM z początku tekstu.
    const tekst = new TextDecoder("utf-8", { fatal: true }).decode(bajty);
    return { ok: true, tekst, kodowanie: bom ? "utf-8-bom" : "utf-8" };
  } catch {
    return { ok: true, tekst: new TextDecoder("windows-1250").decode(bajty), kodowanie: "windows-1250" };
  }
}
