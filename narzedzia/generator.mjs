#!/usr/bin/env node
// Generator danych syntetycznych w formacie pliku godzinowego z eLicznika Taurona.
//
// To jedyne źródło danych testowych w tym repozytorium. Dane nigdy nie powstają z prawdziwych
// plików. Kalendarz jest tu zaimplementowany osobno i prościej niż w app/lib, żeby testy
// narzędzia nie porównywały kodu z nim samym.
//
// Format pliku surowego, jak z eLicznika. Generator odtwarza nasze wyobrażenie o pliku, więc
// przy każdej cesze zaznaczamy, skąd ją znamy.
//
// Potwierdzone na prawdziwych plikach z eLicznika:
// - nagłówek z siedmioma kolumnami (NAGLOWEK_SUROWY), separator średnik, bez cudzysłowów;
//   numer płatnika: 8 cyfr; numer punktu poboru: „PPE:” i 18 cyfr, bez spacji;
// - sześć nazw serii, dokładnie w tym brzmieniu: „energia czynna pobrana netto”, „energia czynna
//   oddana netto”, „energia czynna pobrana”, „energia czynna oddana”, „energia bierna indukcyjna
//   pobrana” i „energia bierna pojemnościowa pobrana”, czyli z końcówką „pobrana” w obu seriach
//   energii biernej. Generator tworzy obie serie „netto” i na życzenie dwie serie energii biernej;
// - serie stoją blokami w kolejności alfabetycznej nazw, wiersze serii rosnąco według czasu;
// - znacznik „RRRR-MM-DD GG:MM” oznacza koniec godziny w czasie lokalnym, północ to „00:00”
//   następnego dnia;
// - wartość z trzema miejscami po przecinku („2,141”, zero to „0,000”), kompletność „100,00”;
// - etykiety stref G13 i ich rozkład; w dni ustawowo wolne (Wigilia od 2025 r.) cała doba to
//   „Reszta dnia”;
// - kodowanie ISO-8859-2 dla liter „ł” (bajt B3) i „ś” (bajt B6); koniec linii CRLF, także po
//   ostatnim wierszu;
// - doba zmiany czasu na zimowy: dwa wiersze „03:00” w każdej serii, jeden po drugim, między
//   „02:00” a „04:00” (widziane w latach 2023, 2024 i 2025); doba zmiany czasu na letni: jest
//   „02:00”, nie ma „03:00”.
//
// Założenia, niesprawdzone na prawdziwym pliku:
// - bajty pozostałych polskich liter: według normy ISO-8859-2;
// - etykiety stref G11 i G12 (generator zna tylko G11: „Reszta dnia” we wszystkich godzinach);
// - postać kompletności poniżej 100 (np. „87,50”);
// - która z dwóch godzin „03:00” jest pierwsza: przyjmujemy, że pierwszy wiersz w pliku to
//   godzina jeszcze w czasie letnim, a drugi już w zimowym;
// - profil wartości, także energii biernej: zmyślony, tylko format jest z eLicznika.
//
// Wyjście: ISO-8859-2 i CRLF, jak w eLiczniku (do testów także UTF-8, UTF-8 z BOM i LF).
//
// Profil jest prosty: w dzień oddanie, w nocy pobór, w każdej godzinie tylko jedno z nich
// niezerowe (bilans godzinowy). Wartość godziny zależy tylko od ziarna i od samej godziny,
// więc dwa pliki o zachodzących zakresach mają w części wspólnej te same wartości.

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

// Fikcyjne numery PPE z celowo błędną cyfrą kontrolną GS1 (poprawne byłyby 3 i 0), więc nie
// mogą należeć do żadnego punktu poboru. Fikcyjni płatnicy mają 8 cyfr jak w eLiczniku.
export const PPE_FIKCYJNE = ["590000000000000010", "590000000000000021"];
export const PLATNICY_FIKCYJNI = ["10000001", "10000002"];

export const NAGLOWEK_SUROWY =
  "Nr platnika;Nr punktu poboru energii;Rodzaj energii;Data i godzina;Strefa;Wartosc[kWh/kvar];Kompletnosc[%]";
export const NAGLOWEK_ZANONIMIZOWANY = "Rodzaj energii;Data i godzina;Strefa;Wartosc[kWh/kvar];Kompletnosc[%]";

export const SERIA_ODDANIE = "energia czynna oddana netto";
export const SERIA_POBOR = "energia czynna pobrana netto";
// Serie energii biernej pod nazwami z pliku eLicznika (w formularzu raportu pola „Energia bierna
// indukcyjna” i „Energia bierna pojemnościowa”). W pliku serie stoją blokami w kolejności
// alfabetycznej nazw.
export const SERIE_BIERNE = ["energia bierna indukcyjna pobrana", "energia bierna pojemnościowa pobrana"];

const STREFA_PRZED = "Szczyt przedpołudniowy";
const STREFA_POPO = "Szczyt popołudniowy";
const STREFA_RESZTA = "Reszta dnia";
const TARYFY = new Set(["G11", "G13"]);

// --- Kalendarz -------------------------------------------------------------------------------

const przestepny = (rok) => (rok % 4 === 0 && rok % 100 !== 0) || rok % 400 === 0;

function dniMiesiaca(rok, miesiac) {
  if (miesiac === 2) return przestepny(rok) ? 29 : 28;
  return [4, 6, 9, 11].includes(miesiac) ? 30 : 31;
}

// Dzień tygodnia metodą Sakamoto: 0 = niedziela, 6 = sobota.
function dzienTygodnia(rok, miesiac, dzien) {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const r = miesiac < 3 ? rok - 1 : rok;
  return (r + Math.floor(r / 4) - Math.floor(r / 100) + Math.floor(r / 400) + t[miesiac - 1] + dzien) % 7;
}

function ostatniaNiedziela(rok, miesiac) {
  const ostatni = dniMiesiaca(rok, miesiac);
  return ostatni - dzienTygodnia(rok, miesiac, ostatni);
}

function nastepnyDzien({ rok, miesiac, dzien }) {
  if (dzien < dniMiesiaca(rok, miesiac)) return { rok, miesiac, dzien: dzien + 1 };
  if (miesiac < 12) return { rok, miesiac: miesiac + 1, dzien: 1 };
  return { rok: rok + 1, miesiac: 1, dzien: 1 };
}

// Wielkanoc w kalendarzu gregoriańskim (algorytm Meeusa, Jonesa i Butchera).
function wielkanoc(rok) {
  const a = rok % 19;
  const b = Math.floor(rok / 100);
  const c = rok % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const miesiac = Math.floor((h + l - 7 * m + 114) / 31);
  const dzien = ((h + l - 7 * m + 114) % 31) + 1;
  return { rok, miesiac, dzien };
}

function przesun(data, dni) {
  let d = data;
  for (let i = 0; i < dni; i++) d = nastepnyDzien(d);
  return d;
}

const mmdd = ({ miesiac, dzien }) => `${String(miesiac).padStart(2, "0")}-${String(dzien).padStart(2, "0")}`;

// Dni ustawowo wolne od pracy. Wigilia jest dniem wolnym od 2025 r.
function swieta(rok) {
  const stale = ["01-01", "01-06", "05-01", "05-03", "08-15", "11-01", "11-11", "12-25", "12-26"];
  if (rok >= 2025) stale.push("12-24");
  const wn = wielkanoc(rok);
  const ruchome = [wn, przesun(wn, 1), przesun(wn, 49), przesun(wn, 60)].map(mmdd);
  return new Set([...stale, ...ruchome]);
}

// Godziny doby jako pary (godzina początku, wystąpienie). Zmiana czasu według reguły UE:
// ostatnia niedziela marca bez godziny 2:00–3:00, ostatnia niedziela października z dwiema.
function godzinyDoby(rok, miesiac, dzien) {
  const wynik = [];
  for (let start = 0; start < 24; start++) {
    if (miesiac === 3 && dzien === ostatniaNiedziela(rok, 3) && start === 2) continue;
    wynik.push({ start, wystapienie: 1 });
    if (miesiac === 10 && dzien === ostatniaNiedziela(rok, 10) && start === 2) {
      wynik.push({ start, wystapienie: 2 });
    }
  }
  return wynik;
}

const dwie = (n) => String(n).padStart(2, "0");

function znacznik(data, start) {
  const koniec = start + 1;
  const d = koniec === 24 ? nastepnyDzien(data) : data;
  return `${d.rok}-${dwie(d.miesiac)}-${dwie(d.dzien)} ${dwie(koniec % 24)}:00`;
}

function strefa(taryfa, data, start, wolne) {
  if (taryfa === "G11") return STREFA_RESZTA;
  const dt = dzienTygodnia(data.rok, data.miesiac, data.dzien);
  if (dt === 0 || dt === 6 || wolne.has(mmdd(data))) return STREFA_RESZTA;
  if (start >= 7 && start < 13) return STREFA_PRZED;
  const lato = data.miesiac >= 4 && data.miesiac <= 9;
  const [od, doGodziny] = lato ? [19, 22] : [16, 21];
  if (start >= od && start < doGodziny) return STREFA_POPO;
  return STREFA_RESZTA;
}

function czytajDate(tekst, nazwa) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tekst ?? "");
  if (!m) throw new Error(`${nazwa}: oczekiwana data RRRR-MM-DD`);
  const data = { rok: +m[1], miesiac: +m[2], dzien: +m[3] };
  if (data.miesiac < 1 || data.miesiac > 12 || data.dzien < 1 || data.dzien > dniMiesiaca(data.rok, data.miesiac)) {
    throw new Error(`${nazwa}: nie ma takiego dnia`);
  }
  return data;
}

const porownajDaty = (a, b) => (a.rok - b.rok) * 10000 + (a.miesiac - b.miesiac) * 100 + (a.dzien - b.dzien);

// --- Wartości --------------------------------------------------------------------------------

// Skrót 32-bitowy z liczb całkowitych (mieszanie jak w murmur3), podstawa losowania.
function skrot(...liczby) {
  let h = 0x9e3779b9;
  for (const n of liczby) {
    let k = Math.imul(n | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    h ^= Math.imul(k, 0x1b873593);
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Godziny początku dnia słonecznego i szczyt oddania w Wh, według miesiąca.
const SLONCE = [
  [8, 15, 900], [7, 16, 1500], [6, 17, 2600], [6, 19, 3400], [5, 20, 4000], [5, 20, 4300],
  [5, 20, 4200], [6, 19, 3800], [6, 18, 3000], [7, 16, 2000], [7, 15, 1100], [8, 15, 700],
];

function wartosciGodziny(ziarno, data, start, wystapienie) {
  const r1 = skrot(ziarno, data.rok, data.miesiac, data.dzien, start, wystapienie, 1);
  const r2 = skrot(ziarno, data.rok, data.miesiac, data.dzien, start, wystapienie, 2);
  const [wschod, zachod, szczyt] = SLONCE[data.miesiac - 1];
  const dzien = start >= wschod && start < zachod;
  if (dzien && r1 % 100 < 85) return { oddanie: 50 + (r2 % szczyt), pobor: 0 };
  if (dzien) return { oddanie: 0, pobor: 100 + (r2 % 1400) };
  return { oddanie: 0, pobor: 80 + (r2 % 900) };
}

// Wh jako tekst kWh z trzema miejscami po przecinku: 2141 -> "2,141".
const kwh = (wh) => `${Math.floor(wh / 1000)},${String(wh % 1000).padStart(3, "0")}`;

// --- Kodowanie -------------------------------------------------------------------------------

// Polskie litery (i twarda spacja) w ISO-8859-2; pozostałe znaki w plikach eLicznika są ASCII.
// Na prawdziwym pliku widzieliśmy tylko „ł” (B3) i „ś” (B6); reszta według normy.
const ISO_8859_2 = new Map(
  Object.entries({
    ą: 0xb1, ć: 0xe6, ę: 0xea, ł: 0xb3, ń: 0xf1, ó: 0xf3, ś: 0xb6, ź: 0xbc, ż: 0xbf,
    Ą: 0xa1, Ć: 0xc6, Ę: 0xca, Ł: 0xa3, Ń: 0xd1, Ó: 0xd3, Ś: 0xa6, Ź: 0xac, Ż: 0xaf,
    "\u00a0": 0xa0, // twarda spacja, do testów psucia pól
  }),
);

function kodujIso88592(tekst) {
  const wynik = new Uint8Array(tekst.length);
  for (let i = 0; i < tekst.length; i++) {
    const kod = tekst.charCodeAt(i);
    if (kod < 0x80) wynik[i] = kod;
    else if (ISO_8859_2.has(tekst[i])) wynik[i] = ISO_8859_2.get(tekst[i]);
    else throw new Error(`znak spoza obsługiwanej części ISO-8859-2: U+${kod.toString(16)}`);
  }
  return wynik;
}

function koduj(tekst, kodowanie) {
  if (kodowanie === "iso-8859-2") return kodujIso88592(tekst);
  const utf8 = new TextEncoder().encode(tekst);
  if (kodowanie === "utf-8") return utf8;
  if (kodowanie === "utf-8-bom") {
    const wynik = new Uint8Array(utf8.length + 3);
    wynik.set([0xef, 0xbb, 0xbf]);
    wynik.set(utf8, 3);
    return wynik;
  }
  throw new Error(`nieznane kodowanie: ${kodowanie}`);
}

// --- Generowanie -----------------------------------------------------------------------------

const KOLUMNA = { seria: 2, znacznik: 3, strefa: 4, wartosc: 5, kompletnosc: 6 };

/**
 * Tworzy plik godzinowy. Zwraca:
 * - surowy: bajty pliku w wariancie surowym (7 kolumn), kodowanie i koniec linii z opcji;
 * - zanonimizowany: bajty wariantu bez dwóch pierwszych kolumn, UTF-8, LF, LF na końcu
 *   (postać, jaką ma dać narzędzie).
 *
 * Opcje: od, do (RRRR-MM-DD, włącznie), taryfa ("G11" | "G13"), ziarno, ppe (18 cyfr; pusty tekst
 * daje pustą kolumnę), platnik (pusty tekst daje pustą kolumnę),
 * kodowanie, koniecLinii, zmianaTaryfy {od, taryfa}, obetnijPoczatek, obetnijKoniec (liczba
 * godzin), bierna (dwie serie energii biernej przed seriami czynnymi, w kolejności alfabetycznej).
 * Psucie: niepelne [{znacznik, kompletnosc}], luka {znacznik, godzin}, powtorz {znacznik,
 * seria, wartoscWh}, odwrocPare (true), drugiPpe (true albo numer), ppeWStrefie {znacznik,
 * seria}, podmien [{znacznik, seria, pole, tekst}].
 * Znacznik w opcjach wskazuje pierwszy wiersz o tym znaczniku w danej serii.
 */
export function generuj(opcje = {}) {
  const {
    taryfa = "G13",
    ziarno = 1,
    ppe = PPE_FIKCYJNE[0],
    platnik = PLATNICY_FIKCYJNI[0],
    kodowanie = "iso-8859-2",
    koniecLinii = "\r\n",
    obetnijPoczatek = 0,
    obetnijKoniec = 0,
  } = opcje;
  const od = czytajDate(opcje.od, "od");
  const doDnia = czytajDate(opcje.do, "do");
  if (porownajDaty(od, doDnia) > 0) throw new Error("od jest późniejsze niż do");
  // Kolumna PPE w eLiczniku ma postać "PPE:" i 18 cyfr; opcja `ppe` podaje same cyfry, a pusty
  // tekst daje pustą kolumnę (plik, w którym klient sam wyczyścił numer).
  const kolumnaPpe = ppe === "" ? "" : `PPE:${ppe}`;
  const zmiana = opcje.zmianaTaryfy ? { ...opcje.zmianaTaryfy, od: czytajDate(opcje.zmianaTaryfy.od, "zmianaTaryfy.od") } : null;
  for (const t of [taryfa, zmiana?.taryfa].filter(Boolean)) {
    if (!TARYFY.has(t)) throw new Error(`nieznana taryfa: ${t} (generator zna G11 i G13)`);
  }

  // Lista godzin z wartościami.
  let godziny = [];
  const wolneWRoku = new Map();
  for (let data = od; porownajDaty(data, doDnia) <= 0; data = nastepnyDzien(data)) {
    if (!wolneWRoku.has(data.rok)) wolneWRoku.set(data.rok, swieta(data.rok));
    const taryfaDnia = zmiana && porownajDaty(data, zmiana.od) >= 0 ? zmiana.taryfa : taryfa;
    for (const { start, wystapienie } of godzinyDoby(data.rok, data.miesiac, data.dzien)) {
      godziny.push({
        znacznik: znacznik(data, start),
        strefa: strefa(taryfaDnia, data, start, wolneWRoku.get(data.rok)),
        ...wartosciGodziny(ziarno, data, start, wystapienie),
        bierna: skrot(ziarno, data.rok, data.miesiac, data.dzien, start, wystapienie, 3) % 400,
        kompletnosc: "100,00",
      });
    }
  }
  godziny = godziny.slice(obetnijPoczatek, godziny.length - obetnijKoniec);

  if (opcje.luka) {
    const i = godziny.findIndex((g) => g.znacznik === opcje.luka.znacznik);
    if (i < 0) throw new Error(`luka: brak znacznika ${opcje.luka.znacznik}`);
    godziny.splice(i, opcje.luka.godzin);
  }
  for (const { znacznik: z, kompletnosc = "75,00" } of opcje.niepelne ?? []) {
    const g = godziny.find((x) => x.znacznik === z);
    if (!g) throw new Error(`niepelne: brak znacznika ${z}`);
    g.kompletnosc = kompletnosc;
  }

  // Wiersze w serii: [płatnik, PPE, seria, znacznik, strefa, wartość, kompletność].
  const serie = {
    oddanie: godziny.map((g) => [platnik, kolumnaPpe, SERIA_ODDANIE, g.znacznik, g.strefa, kwh(g.oddanie), g.kompletnosc]),
    pobor: godziny.map((g) => [platnik, kolumnaPpe, SERIA_POBOR, g.znacznik, g.strefa, kwh(g.pobor), g.kompletnosc]),
  };
  if (opcje.bierna) {
    serie.bierna = SERIE_BIERNE.flatMap((nazwa, i) =>
      godziny.map((g) => [platnik, kolumnaPpe, nazwa, g.znacznik, g.strefa, kwh((g.bierna * (i + 1)) % 500), g.kompletnosc]));
  }

  const znajdz = (nazwaSerii, z) => {
    if (!Object.hasOwn(serie, nazwaSerii)) throw new Error(`nieznana seria: ${nazwaSerii}`);
    const s = serie[nazwaSerii];
    const i = s.findIndex((w) => w[KOLUMNA.znacznik] === z);
    if (i < 0) throw new Error(`brak znacznika ${z} w serii ${nazwaSerii}`);
    return { s, i };
  };

  if (opcje.odwrocPare) {
    for (const s of [serie.oddanie, serie.pobor]) {
      for (let i = 0; i + 1 < s.length; i++) {
        if (s[i][KOLUMNA.znacznik] === s[i + 1][KOLUMNA.znacznik]) {
          [s[i], s[i + 1]] = [s[i + 1], s[i]];
          i++;
        }
      }
    }
  }
  if (opcje.powtorz) {
    const { znacznik: z, seria = "pobor", wartoscWh } = opcje.powtorz;
    const { s, i } = znajdz(seria, z);
    const kopia = [...s[i]];
    if (wartoscWh !== undefined) kopia[KOLUMNA.wartosc] = kwh(wartoscWh);
    s.splice(i + 1, 0, kopia);
  }
  if (opcje.ppeWStrefie) {
    const { s, i } = znajdz(opcje.ppeWStrefie.seria ?? "pobor", opcje.ppeWStrefie.znacznik);
    s[i][KOLUMNA.strefa] = kolumnaPpe;
  }
  for (const { znacznik: z, seria = "pobor", pole, tekst } of opcje.podmien ?? []) {
    if (!Object.hasOwn(KOLUMNA, pole)) throw new Error(`podmien: nieznane pole ${pole}`);
    const { s, i } = znajdz(seria, z);
    s[i][KOLUMNA[pole]] = tekst;
  }

  const wiersze = [...(serie.bierna ?? []), ...serie.oddanie, ...serie.pobor];
  if (opcje.drugiPpe) {
    const drugi = opcje.drugiPpe === true ? PPE_FIKCYJNE[1] : opcje.drugiPpe;
    for (let i = Math.floor(wiersze.length / 2); i < wiersze.length; i++) wiersze[i][1] = `PPE:${drugi}`;
  }

  const surowyTekst = [NAGLOWEK_SUROWY, ...wiersze.map((w) => w.join(";"))].join(koniecLinii) + koniecLinii;
  const anonimTekst = [NAGLOWEK_ZANONIMIZOWANY, ...wiersze.map((w) => w.slice(2).join(";"))].join("\n") + "\n";
  return {
    surowy: koduj(surowyTekst, kodowanie),
    zanonimizowany: new TextEncoder().encode(anonimTekst),
  };
}

// --- Wiersz poleceń --------------------------------------------------------------------------

const POMOC = `Generator danych syntetycznych w formacie eLicznika Taurona.

Użycie:
  node narzedzia/generator.mjs --od RRRR-MM-DD --do RRRR-MM-DD [opcje] [--wyjscie plik.csv]

Opcje:
  --od, --do         zakres dni, włącznie (wymagane)
  --taryfa           G13 (domyślnie) albo G11
  --ziarno           liczba całkowita, domyślnie 1
  --wariant          surowy (domyślnie) albo zanonimizowany
  --kodowanie        iso-8859-2 (domyślnie, jak eLicznik), utf-8, utf-8-bom (tylko wariant surowy)
  --lf               koniec linii LF zamiast CRLF (tylko wariant surowy)
  --drugi-ppe        drugi fikcyjny PPE od połowy pliku
  --bierna           dodaje dwie serie energii biernej
  --wyjscie          plik wynikowy; bez tej opcji wynik idzie na standardowe wyjście
  --help             ta pomoc

Dane są syntetyczne. Numery PPE i płatnika są fikcyjne.
`;

function wierszPolecen(argumenty) {
  const { values } = parseArgs({
    args: argumenty,
    options: {
      od: { type: "string" },
      do: { type: "string" },
      taryfa: { type: "string", default: "G13" },
      ziarno: { type: "string", default: "1" },
      wariant: { type: "string", default: "surowy" },
      kodowanie: { type: "string", default: "iso-8859-2" },
      lf: { type: "boolean", default: false },
      "drugi-ppe": { type: "boolean", default: false },
      bierna: { type: "boolean", default: false },
      wyjscie: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(POMOC);
    return 0;
  }
  if (!/^-?\d+$/.test(values.ziarno)) throw new Error("--ziarno: oczekiwana liczba całkowita");
  if (!["surowy", "zanonimizowany"].includes(values.wariant)) throw new Error("--wariant: surowy albo zanonimizowany");
  const wynik = generuj({
    od: values.od,
    do: values.do,
    taryfa: values.taryfa,
    ziarno: +values.ziarno,
    kodowanie: values.kodowanie,
    koniecLinii: values.lf ? "\n" : "\r\n",
    drugiPpe: values["drugi-ppe"],
    bierna: values.bierna,
  });
  const bajty = values.wariant === "surowy" ? wynik.surowy : wynik.zanonimizowany;
  if (values.wyjscie) writeFileSync(values.wyjscie, bajty);
  else process.stdout.write(bajty);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = wierszPolecen(process.argv.slice(2));
  } catch (blad) {
    process.stderr.write(`generator: ${blad.message}\n`);
    process.exitCode = 2;
  }
}
