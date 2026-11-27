// Rozpoznanie rodzaju pliku i dekodowanie tekstu.
// Kolejność:
// 1. plik większy niż 10 MB: odrzucony;
// 2. znacznik BOM UTF-16 (LE albo BE): odrzucony przed dekodowaniem, bo ISO-8859-2 przyjąłby
//    każdy ciąg bajtów i dał nieczytelny tekst;
// 3. arkusz rozpoznany po pierwszych bajtach: „PK” (.xlsx, .ods) albo D0 CF 11 E0 (.xls);
// 4. bajt zerowy w pierwszych 8 KB: inny plik binarny;
// 5. ścisłe dekodowanie UTF-8 (z obsługą BOM), a gdy się nie uda, ISO-8859-2: w tym kodowaniu
//    eLicznik zapisuje pliki („ś” to bajt B6, „ł” to B3). Plik zapisany ponownie w Windows-1250
//    (np. z arkusza) ma inne bajty niektórych liter; wtedy nazwa serii albo strefy nie przejdzie
//    sprawdzenia i plik zostanie odrzucony, zgodnie z radą, żeby nie zapisywać go w arkuszu.

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
    return { ok: true, tekst: new TextDecoder("iso-8859-2").decode(bajty), kodowanie: "iso-8859-2" };
  }
}

// Podział tekstu na linie po „\n”, z odcięciem znaków CR stojących przed każdym „\n”. Wynik jest
// taki sam jak dla split(/\r*\n/): ostatnia linia (bez „\n” po niej) zostaje nietknięta.
// Wyrażenia nie używamy, bo przy długim ciągu znaków CR bez „\n” ma czas kwadratowy (każdy CR
// zaczyna nowe przeszukanie do końca ciągu), a plik do 10 MB zamroziłby kartę. Tu każdy znak jest
// oglądany raz.
export function podzielNaLinie(tekst) {
  const linie = tekst.split("\n");
  for (let i = 0; i < linie.length - 1; i++) {
    let koniec = linie[i].length;
    while (koniec > 0 && linie[i].charCodeAt(koniec - 1) === 13) koniec--;
    if (koniec < linie[i].length) linie[i] = linie[i].slice(0, koniec);
  }
  return linie;
}
