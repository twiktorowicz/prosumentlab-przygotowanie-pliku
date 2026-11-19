// Składanie zgłoszenia: pliki z licznika, zakres, formularz, uwagi, zawartość ZIP-a.
// Tę samą funkcję wywołuje strona (main.js) i wiersz poleceń (narzedzia/przygotuj.mjs), więc
// oba dają ten sam ZIP co do bajtu dla tych samych danych, numeru i daty.
//
// ZIP powstaje tylko wtedy, gdy:
// - jest co najmniej jeden przyjęty plik;
// - nie ma blokady: bezpiecznik, kilka punktów poboru w pliku, różne punkty poboru w plikach,
//   sprzeczne wartości tej samej godziny;
// - żadne pole formularza nie ma błędu.
// Plik, którego narzędzie nie umie odczytać, nie blokuje: po prostu nie trafia do zgłoszenia.
// Zakres, faktura spoza zakresu i brak pól obowiązkowych tylko informują.

import { dekoduj } from "./dekodowanie.js";
import { czytajTauron } from "./tauron.js";
import { analizujZakres, okresWPelnychDobach } from "./zakres.js";
import { czytajFormularz } from "./formularz.js";
import { numerMiesiaca } from "./kalendarz.js";
import { liczbaZCyfr } from "./kwoty.js";
import { doJson } from "./json.js";
import { utworzZip } from "./zip.js";

export const WERSJA = "0.1.0";
export const ADRES = "raporty@prosumentlab.pl";
export const MAKS_PLIKOW = 10;

const utf8 = (tekst) => new TextEncoder().encode(tekst);

export const nazwaZip = (numer) => `prosumentlab_${numer}.zip`;

// Odnośnik do nowej wiadomości. Temat i treść są już złożone z tekstów (teksty.js); tu tylko
// kodowanie. Odnośnik nie dołącza pliku.
export function odnosnikMailto(temat, tresc) {
  return `mailto:${ADRES}?subject=${encodeURIComponent(temat)}&body=${encodeURIComponent(tresc)}`;
}

// Pliki w kolejności z 8.1: zgloszenie.json, faktury.json (gdy są pola z faktury),
// instalacja.json (gdy są odpowiedzi), pomiary_1.csv, pomiary_2.csv, …
export function zawartoscZip({ zgloszenie, faktury, instalacja, pomiary }) {
  const pliki = [{ nazwa: "zgloszenie.json", bajty: utf8(doJson(zgloszenie)) }];
  if (faktury) pliki.push({ nazwa: "faktury.json", bajty: utf8(doJson(faktury)) });
  if (instalacja) pliki.push({ nazwa: "instalacja.json", bajty: utf8(doJson(instalacja)) });
  pomiary.forEach((tekst, i) => pliki.push({ nazwa: `pomiary_${i + 1}.csv`, bajty: utf8(tekst) }));
  return pliki;
}

const doba = (tekst) => {
  const [rok, miesiac, dzien] = tekst.split("-").map(liczbaZCyfr);
  return { rok, miesiac, dzien };
};

function czytajPliki(bajtyPlikow) {
  return bajtyPlikow.map((bajty, indeks) => {
    if (indeks >= MAKS_PLIKOW) return { indeks, stan: "odrzucony", kod: "blad_za_duzo_plikow" };
    const d = dekoduj(bajty);
    if (!d.ok) return { indeks, stan: "odrzucony", kod: d.kod };
    const w = czytajTauron(d.tekst);
    if (!w.ok) {
      const wynik = { indeks, stan: w.blokada ? "blokada" : "odrzucony", kod: w.kod };
      if (w.wiersz !== undefined) wynik.wiersz = w.wiersz;
      return wynik;
    }
    return { indeks, stan: w.uwagi.length > 0 ? "uwaga" : "przyjety", kodowanie: d.kodowanie, odczyt: w };
  });
}

// Część zależna tylko od plików: odczyt, kolejność w ZIP-ie, zakres i blokady plików. Strona
// liczy ją raz po zmianie listy plików, a przy zmianie pola formularza tylko składa zgłoszenie
// (zlozZgloszenie). Wynik nie przechowuje bajtów wejściowych i nie jest później zmieniany.
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
export function przygotujZgloszenie({ pliki, formularz, numer, utworzono }) {
  return zlozZgloszenie({ przygotowane: przygotujPliki(pliki), formularz, numer, utworzono });
}

// Zgłoszenie z przygotowanych plików (przygotujPliki) i formularza.
export function zlozZgloszenie({ przygotowane, formularz, numer, utworzono }) {
  const { pliki, przyjete, analiza } = przygotowane;
  const blokady = [...przygotowane.blokady];

  const form = czytajFormularz(formularz);

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
  if (form.brakujace.length > 0) uwagi.push({ kod: "FAKTURA_BRAK_OBOWIAZKOWYCH", gdzie: "raport", pola: [...form.brakujace] });
  if (r.system_rozliczenia === "opusty") uwagi.push({ kod: "FAKTURA_OPUSTY", gdzie: "raport" });
  if (analiza) {
    const od = numerMiesiaca(analiza.miesiacePlikow.od.rok, analiza.miesiacePlikow.od.miesiac);
    const doM = numerMiesiaca(analiza.miesiacePlikow.do.rok, analiza.miesiacePlikow.do.miesiac);
    (form.instalacja.zmiany ?? []).forEach((z, i) => {
      const [rok, miesiac] = z.miesiac.split("-").map(liczbaZCyfr);
      const m = numerMiesiaca(rok, miesiac);
      if (m < od || m > doM) uwagi.push({ kod: "INSTALACJA_MIESIAC_POZA_ZAKRESEM", gdzie: `instalacja.zmiany[${i}]` });
    });
  }

  let powod = null;
  if (blokady.length > 0) powod = "blokada";
  else if (przyjete.length === 0) powod = "brak_plikow";
  else if (form.bledy.length > 0) powod = "bledy_pol";

  const zgloszenie = {
    format: "prosumentlab/zgloszenie",
    wersja_formatu: 1,
    narzedzie: WERSJA,
    numer,
    utworzono,
    zgoda_przypadek_testowy: form.zgoda,
    tryb: "tauron",
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
  const instalacja = Object.keys(form.instalacja).length > 0
    ? { format: "prosumentlab/instalacja", wersja_formatu: 1, ...form.instalacja }
    : null;
  const zawartosc = zawartoscZip({ zgloszenie, faktury, instalacja, pomiary: przyjete.map((p) => p.odczyt.wynik) });

  return {
    pliki: pliki.map(({ odczyt, ...p }) => ({
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
    zawartosc,
    moznaZapisac: powod === null,
    powod,
    nazwaZip: nazwaZip(numer),
    zip: powod === null ? utworzZip(zawartosc) : null,
  };
}
