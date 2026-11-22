// Składanie zgłoszenia: pliki z licznika, zakres, formularz, uwagi, zawartość ZIP-a.
// Tę samą funkcję wywołuje strona (main.js) i wiersz poleceń (narzedzia/przygotuj.mjs), więc
// oba dają ten sam ZIP co do bajtu dla tych samych danych, numeru i daty.
//
// ZIP powstaje tylko wtedy, gdy:
// - jest co najmniej jeden przyjęty plik;
// - nie ma blokady: bezpiecznik w pliku albo w plikach JSON, kilka punktów poboru w pliku, różne
//   punkty poboru w plikach, sprzeczne wartości tej samej godziny;
// - żadne pole formularza nie ma błędu.
// Plik, którego narzędzie nie umie odczytać, nie blokuje: po prostu nie trafia do zgłoszenia.
// Duplikat też nie trafia (czytajPliki): ten sam wynik po usunięciu kolumn co plik wcześniej
// przyjęty i te same numery albo żadnych numerów.
// Zakres, faktura spoza zakresu, brak pól obowiązkowych i pliki bez numerów tylko informują.
//
// Treść CSV jest kodowana raz, przy odczycie plików (przygotujPliki), razem z sumą CRC. Złożenie
// zgłoszenia po zmianie pola buduje tylko pliki JSON; archiwum powstaje dopiero przy zapisie
// (utworzZipZgloszenia). Archiwum jest kompresowane asynchronicznie (zip.js), więc
// utworzZipZgloszenia i przygotujZgloszenie zwracają obietnicę.

import { dekoduj } from "./dekodowanie.js";
import { czytajTauron } from "./tauron.js";
import { analizujZakres, okresWPelnychDobach } from "./zakres.js";
import { czytajFormularz } from "./formularz.js";
import { numerMiesiaca } from "./kalendarz.js";
import { liczbaZCyfr } from "./kwoty.js";
import { doJson } from "./json.js";
import { utworzZip } from "./zip.js";
import { crc32 } from "./crc32.js";
import { sprawdzBezpiecznik } from "./bezpiecznik.js";

export const WERSJA = "0.1.5";
export const ADRES = "raporty@prosumentlab.pl";
export const MAKS_PLIKOW = 10;
// Tryb narzędzia i operator sieci, od którego pochodzi plik w tym trybie (eLicznik to portal
// Tauron Dystrybucja). Klient operatora nie wybiera.
const TRYB = "tauron";
const OPERATOR_TRYBU = { tauron: "tauron_dystrybucja" };

const utf8 = (tekst) => new TextEncoder().encode(tekst);

export const nazwaZip = (numer) => `prosumentlab_${numer}.zip`;

// Odnośnik do nowej wiadomości. Temat i treść są już złożone z tekstów (teksty.js); tu tylko
// kodowanie. Odnośnik nie dołącza pliku.
export function odnosnikMailto(temat, tresc) {
  return `mailto:${ADRES}?subject=${encodeURIComponent(temat)}&body=${encodeURIComponent(tresc)}`;
}

// Pliki w kolejności: zgloszenie.json, faktury.json (gdy są pola z faktury), instalacja.json
// (gdy są odpowiedzi), pomiary_1.csv, pomiary_2.csv, … Pomiar to tekst albo gotowe bajty
// z sumą CRC ({ bajty, crc }).
export function zawartoscZip({ zgloszenie, faktury, instalacja, pomiary }) {
  const pliki = [{ nazwa: "zgloszenie.json", bajty: utf8(doJson(zgloszenie)) }];
  if (faktury) pliki.push({ nazwa: "faktury.json", bajty: utf8(doJson(faktury)) });
  if (instalacja) pliki.push({ nazwa: "instalacja.json", bajty: utf8(doJson(instalacja)) });
  pomiary.forEach((p, i) => {
    const nazwa = `pomiary_${i + 1}.csv`;
    pliki.push(typeof p === "string" ? { nazwa, bajty: utf8(p) } : { nazwa, bajty: p.bajty, crc: p.crc });
  });
  return pliki;
}

const PLIKI_JSON = new Set(["zgloszenie.json", "faktury.json", "instalacja.json"]);

const doba = (tekst) => {
  const [rok, miesiac, dzien] = tekst.split("-").map(liczbaZCyfr);
  return { rok, miesiac, dzien };
};

const teSameNumery = (a, b) => a.length === b.length && a.every((w, i) => w === b[i]);

// Duplikat: ten sam wynik co plik wcześniej przyjęty i albo te same usunięte numery (płatnik,
// PPE), albo plik sam nie ma żadnych numerów. Plik z numerami jest duplikatem tylko pliku z tymi
// samymi numerami, więc plik o tych samych wartościach z innym PPE albo płatnikiem wchodzi do
// porównania punktów poboru i blokuje zapis (blad_rozne_ppe), zamiast zniknąć z listy. Kopia
// bez numerów pliku surowego nie wnosi danych ani nie może dać sprzeczności, więc dalej jest
// duplikatem.
function czytajPliki(bajtyPlikow) {
  const wyniki = new Map(); // wynik -> lista usuniętych numerów każdego przyjętego pliku
  return bajtyPlikow.map((bajty, indeks) => {
    if (indeks >= MAKS_PLIKOW) return { indeks, stan: "odrzucony", kod: "blad_za_duzo_plikow" };
    // Wyjątek przy odczycie jednego pliku nie może zatrzymać pozostałych ani strony: taki plik
    // narzędzie traktuje jak plik, którego nie odczytało.
    let d;
    let w;
    try {
      d = dekoduj(bajty);
      if (d.ok) w = czytajTauron(d.tekst);
    } catch {
      return { indeks, stan: "odrzucony", kod: "blad_nieznany" };
    }
    if (!d.ok) return { indeks, stan: "odrzucony", kod: d.kod };
    if (!w.ok) {
      const wynik = { indeks, stan: w.blokada ? "blokada" : "odrzucony", kod: w.kod };
      if (w.wiersz !== undefined) wynik.wiersz = w.wiersz;
      return wynik;
    }
    // Duplikat jest poza ZIP-em i analizą zakresu.
    const wczesniejsze = wyniki.get(w.wynik) ?? [];
    if (wczesniejsze.some((numery) => w.usunieteWartosci.length === 0 || teSameNumery(numery, w.usunieteWartosci))) {
      return { indeks, stan: "odrzucony", kod: "blad_duplikat" };
    }
    wyniki.set(w.wynik, [...wczesniejsze, w.usunieteWartosci]);
    const bajtyCsv = utf8(w.wynik);
    return {
      indeks,
      stan: w.uwagi.length > 0 ? "uwaga" : "przyjety",
      kodowanie: d.kodowanie,
      odczyt: w,
      csv: { bajty: bajtyCsv, crc: crc32(bajtyCsv) },
    };
  });
}

// Część zależna tylko od plików: odczyt, kolejność w ZIP-ie, zakres i blokady plików, a także
// treść CSV zakodowana raz w UTF-8 z sumą CRC. Strona liczy ją raz po zmianie listy plików,
// a przy zmianie pola formularza tylko składa zgłoszenie (zlozZgloszenie). Wynik nie przechowuje
// bajtów wejściowych i nie jest później zmieniany.
export function przygotujPliki(bajtyPlikow) {
  const pliki = czytajPliki(bajtyPlikow);
  const blokady = pliki
    .filter((p) => p.stan === "blokada")
    .map((p) => (p.wiersz === undefined ? { kod: p.kod, plik: p.indeks } : { kod: p.kod, plik: p.indeks, wiersz: p.wiersz }));

  // Przyjęte pliki w kolejności pierwszej godziny; tak trafiają do ZIP-a jako pomiary_N.csv.
  const przyjete = pliki
    .filter((p) => p.odczyt)
    .sort((a, b) => a.odczyt.pierwszyPorzadek - b.odczyt.pierwszyPorzadek || a.indeks - b.indeks);
  przyjete.forEach((p, i) => {
    p.nazwa = `pomiary_${i + 1}.csv`;
  });

  const analiza = przyjete.length > 0 ? analizujZakres(przyjete.map((p) => p.odczyt)) : null;
  if (analiza) blokady.push(...analiza.blokady);
  return { pliki, przyjete, analiza, blokady };
}

/**
 * Całe zgłoszenie z bajtów plików (wiersz poleceń i testy).
 * @param {object} p
 * @param {Uint8Array[]} p.pliki bajty plików w kolejności wyboru
 * @param {object} p.formularz surowe wartości pól (formularz.js)
 * @param {string} p.numer numer zgłoszenia XXXX-XXXX
 * @param {string} p.utworzono dzień RRRR-MM-DD z zegara urządzenia, tylko informacja
 */
// Tu ZIP powstaje od razu, bo wiersz poleceń zapisuje go zawsze; `zip` to null, gdy zapis jest
// niemożliwy. Zwraca obietnicę (kompresja jest asynchroniczna).
export async function przygotujZgloszenie({ pliki, formularz, numer, utworzono }) {
  const wynik = zlozZgloszenie({ przygotowane: przygotujPliki(pliki), formularz, numer, utworzono });
  return { ...wynik, zip: wynik.moznaZapisac ? await utworzZipZgloszenia(wynik) : null };
}

// Archiwum ZIP ze złożonego zgłoszenia (obietnica). Odmawia (odrzucona obietnica), gdy zapis jest
// niemożliwy: blokada, brak plików albo błąd pola.
export async function utworzZipZgloszenia(wynik) {
  if (!wynik.moznaZapisac) throw new Error(`zapis niemożliwy: ${wynik.powod}`);
  return utworzZip(wynik.zawartosc);
}

// Zgłoszenie z przygotowanych plików (przygotujPliki) i formularza.
export function zlozZgloszenie({ przygotowane, formularz, numer, utworzono }) {
  const { pliki, przyjete, analiza } = przygotowane;
  const blokady = [...przygotowane.blokady];

  const form = czytajFormularz(formularz, { operator: OPERATOR_TRYBU[TRYB], dzisiaj: utworzono });

  // Uwagi w kolejności: pliki, zakres, faktura, instalacja. Pola poza `kod` i `gdzie` służą
  // tylko do komunikatów na stronie i nie trafiają do zgloszenie.json.
  const uwagi = [];
  przyjete.forEach((p, i) => {
    for (const u of p.odczyt.uwagi) uwagi.push({ ...u, gdzie: `pliki[${i}]` });
  });
  if (analiza) for (const u of analiza.uwagi) uwagi.push({ ...u, gdzie: "zakres" });
  const r = form.raport;
  if (analiza && r.okres_od && r.okres_do && !okresWPelnychDobach(analiza, doba(r.okres_od), doba(r.okres_do))) {
    uwagi.push({ kod: "FAKTURA_R_POZA_ZAKRESEM", gdzie: "raport" });
  }
  for (const u of form.uwagi) uwagi.push({ ...u, gdzie: "raport" });
  if (form.brakujace.length > 0) uwagi.push({ kod: "FAKTURA_BRAK_OBOWIAZKOWYCH", gdzie: "raport", pola: [...form.brakujace] });
  if (r.system_rozliczenia === "opusty") uwagi.push({ kod: "FAKTURA_OPUSTY", gdzie: "raport" });
  // Analiza bez żadnej istniejącej godziny (np. plik z samą godziną 03:00 z doby zmiany czasu
  // na letni) nie ma miesięcy plików, więc nie ma z czym porównać miesięcy instalacji.
  if (analiza?.miesiacePlikow) {
    const od = numerMiesiaca(analiza.miesiacePlikow.od.rok, analiza.miesiacePlikow.od.miesiac);
    const doM = numerMiesiaca(analiza.miesiacePlikow.do.rok, analiza.miesiacePlikow.do.miesiac);
    (form.instalacja.zmiany ?? []).forEach((z, i) => {
      const [rok, miesiac] = z.miesiac.split("-").map(liczbaZCyfr);
      const m = numerMiesiaca(rok, miesiac);
      if (m < od || m > doM) uwagi.push({ kod: "INSTALACJA_MIESIAC_POZA_ZAKRESEM", gdzie: `instalacja.zmiany[${i}]` });
    });
  }

  const zgloszenie = {
    format: "prosumentlab/zgloszenie",
    wersja_formatu: 1,
    narzedzie: WERSJA,
    numer,
    utworzono,
    zgoda_przypadek_testowy: form.zgoda,
    tryb: TRYB,
    ppe_porownane: analiza ? analiza.ppePorownane : false,
    pliki: przyjete.map((p) => {
      const o = p.odczyt;
      const opis = {
        nazwa: p.nazwa,
        wariant_wejscia: o.wariant,
        kodowanie_wejscia: p.kodowanie,
        wiersze_danych: o.wierszeDanych,
        pierwszy_znacznik: o.pierwszyZnacznik,
        ostatni_znacznik: o.ostatniZnacznik,
      };
      if (o.usunieteKolumny.length > 0) opis.usuniete_kolumny = [...o.usunieteKolumny];
      return opis;
    }),
    zakres: analiza ? analiza.zakres : { pelne_miesiace: 0, ciag_miesiace: 0, klasyfikacja: "za_krotki" },
  };
  if (uwagi.length > 0) zgloszenie.uwagi = uwagi.map(({ kod, gdzie }) => ({ kod, gdzie }));

  const faktury = Object.keys(r).length > 0 ? { format: "prosumentlab/faktury", wersja_formatu: 1, raport: r } : null;
  // Wersja 2 formatu instalacja.json: wpis zmiany „rozbudowa_pv” może mieć klucz moc_przed_kwp.
  // Pozostałe klucze jak w wersji 1.
  const instalacja = Object.keys(form.instalacja).length > 0
    ? { format: "prosumentlab/instalacja", wersja_formatu: 2, ...form.instalacja }
    : null;
  const zawartosc = zawartoscZip({ zgloszenie, faktury, instalacja, pomiary: przyjete.map((p) => p.csv) });

  // Reguły bezpiecznika 1–5 na plikach JSON, przy każdym złożeniu: pola wpisane ręcznie nie mogą
  // wnieść numeru z pliku, słowa PPE, kodu GS1 ani adresu e-mail.
  const usuniete = przyjete.flatMap((p) => p.odczyt.usunieteWartosci);
  const dekoder = new TextDecoder();
  const wJson = zawartosc
    .filter((p) => PLIKI_JSON.has(p.nazwa))
    .some((p) => sprawdzBezpiecznik(dekoder.decode(p.bajty).split("\n").map((tekst, i) => ({ tekst, linia: i + 1 })), usuniete, { regula6: false }));
  if (wJson) blokady.push({ kod: "blad_bezpiecznik_formularz" });

  let powod = null;
  if (blokady.length > 0) powod = "blokada";
  else if (przyjete.length === 0) powod = "brak_plikow";
  else if (form.bledy.length > 0) powod = "bledy_pol";

  return {
    pliki: pliki.map(({ odczyt, csv, ...p }) => ({
      ...p,
      ...(odczyt && {
        wariant: odczyt.wariant,
        wierszeDanych: odczyt.wierszeDanych,
        pierwszyZnacznik: odczyt.pierwszyZnacznik,
        ostatniZnacznik: odczyt.ostatniZnacznik,
        usunieteKolumny: odczyt.usunieteKolumny,
        pierwszeWiersze: odczyt.wynik.split("\n").slice(1, 6),
        uwagi: odczyt.uwagi,
      }),
    })),
    blokady,
    bledyPol: form.bledy,
    brakujace: form.brakujace,
    uwagi,
    zakres: zgloszenie.zakres,
    miesiace: analiza ? analiza.miesiace : [],
    zgoda: form.zgoda,
    // Kilka plików, a punktów poboru nie da się porównać (plik bez numerów): tylko informacja na
    // stronie, bez zmiany formatu JSON.
    uwagaBezNumerow: przyjete.length > 1 && !zgloszenie.ppe_porownane,
    zawartosc,
    moznaZapisac: powod === null,
    powod,
    nazwaZip: nazwaZip(numer),
  };
}
