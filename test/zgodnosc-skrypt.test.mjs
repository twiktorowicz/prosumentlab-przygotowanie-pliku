// Zgodność ZIP-a z narzędzia z warunkami skryptu, który przyjmuje zgłoszenia na stronie. Skrypt
// czyta ZIP własnym, krótkim parserem i odrzuca każdy, który nie spełnia czterech warunków budowy:
// 1. rekord końca katalogu centralnego na końcu pliku, bez komentarza, jeden dysk, od 2 do 13
//    wpisów;
// 2. wpisy katalogu i nagłówki lokalne zgodne (nazwa, metoda, CRC, rozmiary), pliki kolejno, bez
//    przerw i nakładania, bez szyfrowania, ZIP64 i deskryptora danych; wpisy bez pól dodatkowych
//    i komentarzy, z zerowymi atrybutami pliku i systemem 0 w polu „wersja tworzenia”;
// 3. nazwy tylko z listy: zgloszenie.json (pierwszy, obowiązkowy), faktury.json, instalacja.json,
//    pomiary_1.csv … pomiary_10.csv (co najmniej jeden, numeracja bez luk), każda najwyżej raz;
// 4. metoda 0 albo 8; po rozpakowaniu JSON najwyżej 64 KiB, CSV najwyżej 4 MiB, razem najwyżej
//    40 MiB; stosunek sumy rozmiarów po rozpakowaniu do sumy rozmiarów spakowanych najwyżej 50,
//    liczony z nagłówków dla całego ZIP-a.
// Sprawdzenie niżej jest napisane od nowa według tych warunków, bez czytnika z test/pomoc.
// Wysyłka przez stronę przyjmuje ZIP najwyżej 5 MiB; test podaje zmierzony rozmiar. ZIP bez
// kompresji (metoda 0: przeglądarka bez CompressionStream("deflate-raw") albo nieudana kompresja)
// przechodzi te same warunki.

import { test } from "node:test";
import assert from "node:assert/strict";
import { przygotujZgloszenie } from "../app/lib/zgloszenie.js";
import { generuj } from "../narzedzia/generator.mjs";
import { bezKompresji } from "./pomoc/bez-kompresji.mjs";

const KIB = 1024;
const MIB = 1024 * KIB;
const LIMIT_WYSYLKI = 5 * MIB;

// Zwraca listę naruszeń warunków 1–4 i sumy rozmiarów z nagłówków.
function sprawdzJakSkrypt(zip) {
  const bledy = [];
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);

  // 1.
  const eocd = zip.length - 22;
  if (eocd < 0 || u32(eocd) !== 0x06054b50) return { bledy: ["1: brak rekordu końca na końcu pliku"] };
  if (u16(eocd + 20) !== 0) bledy.push("1: komentarz w rekordzie końca");
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0) bledy.push("1: więcej niż jeden dysk");
  const liczba = u16(eocd + 10);
  if (u16(eocd + 8) !== liczba) bledy.push("1: różna liczba wpisów na dysku i razem");
  if (liczba < 2 || liczba > 13) bledy.push(`1: liczba wpisów ${liczba}`);
  const rozmiarKatalogu = u32(eocd + 12);
  const poczatekKatalogu = u32(eocd + 16);
  if (poczatekKatalogu + rozmiarKatalogu !== eocd) bledy.push("2: bajty między katalogiem a rekordem końca");

  // 2.
  const wpisy = [];
  let o = poczatekKatalogu;
  let koniecPoprzedniego = 0;
  for (let i = 0; i < liczba; i++) {
    if (u32(o) !== 0x02014b50) {
      bledy.push(`2: zły podpis wpisu ${i}`);
      break;
    }
    const w = {
      wersjaTworzenia: u16(o + 4), wersjaPotrzebna: u16(o + 6), flagi: u16(o + 8), metoda: u16(o + 10),
      crc: u32(o + 16), spakowany: u32(o + 20), rozmiar: u32(o + 24), dlugoscNazwy: u16(o + 28),
      dodatkowe: u16(o + 30), komentarz: u16(o + 32), dysk: u16(o + 34), wewnetrzne: u16(o + 36),
      zewnetrzne: u32(o + 38), lokalny: u32(o + 42),
    };
    w.nazwa = new TextDecoder("latin1").decode(zip.subarray(o + 46, o + 46 + w.dlugoscNazwy));
    if (w.flagi & 0x0001) bledy.push(`2: ${w.nazwa}: szyfrowanie`);
    if (w.flagi & 0x0008) bledy.push(`2: ${w.nazwa}: deskryptor danych`);
    if (w.spakowany === 0xffffffff || w.rozmiar === 0xffffffff || w.lokalny === 0xffffffff) bledy.push(`2: ${w.nazwa}: ZIP64`);
    if (w.dodatkowe !== 0) bledy.push(`2: ${w.nazwa}: pola dodatkowe we wpisie`);
    if (w.komentarz !== 0) bledy.push(`2: ${w.nazwa}: komentarz wpisu`);
    if (w.dysk !== 0) bledy.push(`2: ${w.nazwa}: numer dysku`);
    if (w.wewnetrzne !== 0 || w.zewnetrzne !== 0) bledy.push(`2: ${w.nazwa}: atrybuty pliku`);
    if (w.wersjaTworzenia >> 8 !== 0) bledy.push(`2: ${w.nazwa}: system ${w.wersjaTworzenia >> 8}`);

    const l = w.lokalny;
    if (l !== koniecPoprzedniego) bledy.push(`2: ${w.nazwa}: przerwa albo nakładanie przed plikiem`);
    if (u32(l) !== 0x04034b50) bledy.push(`2: ${w.nazwa}: zły podpis nagłówka lokalnego`);
    const nazwaLokalna = new TextDecoder("latin1").decode(zip.subarray(l + 30, l + 30 + u16(l + 26)));
    if (u16(l + 4) !== w.wersjaPotrzebna || u16(l + 6) !== w.flagi || u16(l + 8) !== w.metoda || u32(l + 14) !== w.crc ||
      u32(l + 18) !== w.spakowany || u32(l + 22) !== w.rozmiar || nazwaLokalna !== w.nazwa) {
      bledy.push(`2: ${w.nazwa}: nagłówek lokalny różny od wpisu`);
    }
    if (u16(l + 28) !== 0) bledy.push(`2: ${w.nazwa}: pola dodatkowe w nagłówku lokalnym`);
    koniecPoprzedniego = l + 30 + u16(l + 26) + u16(l + 28) + w.spakowany;
    wpisy.push(w);
    o += 46 + w.dlugoscNazwy + w.dodatkowe + w.komentarz;
  }
  if (koniecPoprzedniego !== poczatekKatalogu) bledy.push("2: przerwa między ostatnim plikiem a katalogiem");

  // 3.
  const nazwy = wpisy.map((w) => w.nazwa);
  if (nazwy[0] !== "zgloszenie.json") bledy.push("3: zgloszenie.json nie jest pierwszy");
  if (new Set(nazwy).size !== nazwy.length) bledy.push("3: powtórzona nazwa");
  const pomiary = [];
  for (const n of nazwy) {
    const m = /^pomiary_([1-9]|10)\.csv$/.exec(n);
    if (m) pomiary.push(Number(m[1]));
    else if (!["zgloszenie.json", "faktury.json", "instalacja.json"].includes(n)) bledy.push(`3: nazwa spoza listy: ${n}`);
  }
  if (pomiary.length === 0) bledy.push("3: brak pomiarów");
  const posortowane = [...pomiary].sort((a, b) => a - b);
  if (!posortowane.every((n, i) => n === i + 1)) bledy.push("3: luka w numeracji pomiarów");

  // 4.
  let razem = 0;
  let spakowane = 0;
  for (const w of wpisy) {
    if (w.metoda !== 0 && w.metoda !== 8) bledy.push(`4: ${w.nazwa}: metoda ${w.metoda}`);
    if (w.nazwa.endsWith(".json") && w.rozmiar > 64 * KIB) bledy.push(`4: ${w.nazwa}: JSON ponad 64 KiB`);
    if (w.nazwa.endsWith(".csv") && w.rozmiar > 4 * MIB) bledy.push(`4: ${w.nazwa}: CSV ponad 4 MiB`);
    razem += w.rozmiar;
    spakowane += w.spakowany;
  }
  if (razem > 40 * MIB) bledy.push("4: razem ponad 40 MiB");
  const stosunek = razem / spakowane;
  if (!(stosunek <= 50)) bledy.push(`4: stosunek ${stosunek}`);
  return { bledy, wpisy, razem, spakowane, stosunek };
}

const NUMER = "K7M3-Q9TX";
const DATA = "2026-11-19";
const FORMULARZ = {
  faktura: {
    sprzedawca: "tauron_sprzedaz", taryfa: "g13", okres_miesiac: "2025-11", rodzaj_faktury: "rozliczeniowa",
    system_rozliczenia: "net_billing_rce", rodzaj_ceny: "stala", cena_energii_netto_zl_kwh: ["0,60000", "0,70000", "0,40000"],
    oplata_mocowa_zl_mies: "12,34",
  },
  instalacja: { moc_pv_kwp: "7,2", magazyn: "nie", zmiany: [{ rodzaj: "rozbudowa_pv", miesiac: "2025-05", moc_przed_kwp: "3,1" }] },
  zgoda: true,
};

const opisz = (s, zip) =>
  `ZIP ${zip.length} B (${(zip.length / MIB).toFixed(2)} MiB), po rozpakowaniu ${s.razem} B, stosunek ${s.stosunek.toFixed(2)}`;

test("ZIP z generatora za 12 miesięcy spełnia warunki 1–4 skryptu, metoda 8, stosunek poniżej 30", async (t) => {
  const w = await przygotujZgloszenie({
    pliki: [generuj({ od: "2025-01-01", do: "2025-12-31", ziarno: 13 }).surowy],
    formularz: FORMULARZ, numer: NUMER, utworzono: DATA,
  });
  assert.equal(w.moznaZapisac, true, w.powod);
  const s = sprawdzJakSkrypt(w.zip);
  assert.deepEqual(s.bledy, []);
  assert.deepEqual(s.wpisy.map((x) => x.nazwa), ["zgloszenie.json", "faktury.json", "instalacja.json", "pomiary_1.csv"]);
  assert.ok(s.wpisy.every((x) => x.metoda === 8));
  // Zapas wobec granicy 50: typowe zgłoszenie ma być od niej daleko.
  assert.ok(s.stosunek < 30, opisz(s, w.zip));
  assert.ok(w.zip.length <= LIMIT_WYSYLKI);
  t.diagnostic(`12 miesięcy: ${opisz(s, w.zip)}`);
});

test("największe zgłoszenie (10 plików po 12 miesięcy) spełnia warunki 1–4 i mieści się w 5 MiB", async (t) => {
  const pliki = Array.from({ length: 10 }, (_, i) => generuj({ od: `${2016 + i}-01-01`, do: `${2016 + i}-12-31`, ziarno: 20 + i }).surowy);
  const w = await przygotujZgloszenie({ pliki, formularz: FORMULARZ, numer: NUMER, utworzono: DATA });
  assert.equal(w.moznaZapisac, true, w.powod);
  const s = sprawdzJakSkrypt(w.zip);
  assert.deepEqual(s.bledy, []);
  assert.equal(s.wpisy.length, 13);
  assert.ok(w.zip.length <= LIMIT_WYSYLKI, opisz(s, w.zip));
  t.diagnostic(`10 × 12 miesięcy: ${opisz(s, w.zip)}`);
});

test("ZIP bez kompresji (metoda 0) za 12 miesięcy spełnia te same warunki 1–4 skryptu, stosunek 1", async (t) => {
  const w = await bezKompresji(() => przygotujZgloszenie({
    pliki: [generuj({ od: "2025-01-01", do: "2025-12-31", ziarno: 13 }).surowy],
    formularz: FORMULARZ, numer: NUMER, utworzono: DATA,
  }));
  assert.equal(w.moznaZapisac, true, w.powod);
  const s = sprawdzJakSkrypt(w.zip);
  assert.deepEqual(s.bledy, []);
  assert.deepEqual(s.wpisy.map((x) => x.nazwa), ["zgloszenie.json", "faktury.json", "instalacja.json", "pomiary_1.csv"]);
  assert.ok(s.wpisy.every((x) => x.metoda === 0 && x.spakowany === x.rozmiar));
  assert.equal(s.stosunek, 1);
  assert.ok(w.zip.length <= LIMIT_WYSYLKI, opisz(s, w.zip));
  t.diagnostic(`12 miesięcy bez kompresji: ${opisz(s, w.zip)}`);
});

test("największe zgłoszenie bez kompresji (metoda 0) spełnia warunki 1–4, ale ma ponad 5 MiB", async (t) => {
  const pliki = Array.from({ length: 10 }, (_, i) => generuj({ od: `${2016 + i}-01-01`, do: `${2016 + i}-12-31`, ziarno: 20 + i }).surowy);
  const w = await bezKompresji(() => przygotujZgloszenie({ pliki, formularz: FORMULARZ, numer: NUMER, utworzono: DATA }));
  assert.equal(w.moznaZapisac, true, w.powod);
  const s = sprawdzJakSkrypt(w.zip);
  assert.deepEqual(s.bledy, []);
  assert.equal(s.wpisy.length, 13);
  assert.ok(s.wpisy.every((x) => x.metoda === 0));
  // Takiego ZIP-a narzędzie nie wysyła przez stronę (limit wysyłki, wysylka_za_duzy).
  assert.ok(w.zip.length > LIMIT_WYSYLKI, opisz(s, w.zip));
  t.diagnostic(`10 × 12 miesięcy bez kompresji: ${opisz(s, w.zip)}`);
});

test("sprawdzenie jak w skrypcie odrzuca ZIP z naruszeniem warunku", async () => {
  const w = await przygotujZgloszenie({
    pliki: [generuj({ od: "2025-06-01", do: "2025-06-03", ziarno: 2 }).surowy], formularz: {}, numer: NUMER, utworzono: DATA,
  });
  assert.deepEqual(sprawdzJakSkrypt(w.zip).bledy, []);
  const katalog = new DataView(w.zip.buffer, w.zip.byteOffset).getUint32(w.zip.length - 22 + 16, true);
  const zepsuj = (o, zapis) => {
    const kopia = w.zip.slice();
    zapis(new DataView(kopia.buffer), o);
    return sprawdzJakSkrypt(kopia).bledy;
  };
  assert.match(zepsuj(katalog + 10, (d, o) => d.setUint16(o, 12, true)).join(), /metoda 12/);
  assert.match(zepsuj(katalog + 8, (d, o) => d.setUint16(o, 8, true)).join(), /deskryptor/);
  assert.match(zepsuj(katalog + 5, (d, o) => d.setUint8(o, 3)).join(), /system 3/);
  assert.match(zepsuj(katalog + 24, (d, o) => d.setUint32(o, 1 << 30, true)).join(), /nagłówek lokalny różny|stosunek|64 KiB/);
  assert.match(zepsuj(w.zip.length - 22 + 10, (d, o) => d.setUint16(o, 1, true)).join(), /liczba wpisów 1|różna liczba/);
});
