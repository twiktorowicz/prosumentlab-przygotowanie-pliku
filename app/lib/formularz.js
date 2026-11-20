// Formularz: pola grupy R z najnowszej faktury rozliczeniowej i odpowiedzi o instalacji.
//
// Wejście to surowe wartości pól tak, jak wpisał je klient (tekst), listy wyboru jako
// identyfikatory. Wynik:
// - raport, instalacja: wartości do JSON-a, klucze w ustalonej kolejności; pole puste nie ma
//   klucza, pusta lista też;
// - bledy: pola, których nie da się odczytać albo nie przechodzą kontroli; takie pole nie trafia
//   do danych i blokuje zapis, dopóki klient go nie poprawi albo nie wyczyści;
// - brakujace: puste pola obowiązkowe grupy R; to tylko informacja, bez blokady.
// Kody błędów odpowiadają kluczom tekstów w app/teksty.js; `blad_wyboru` i
// `faktura_data_format` dotyczą wartości, których strona sama nie wytwarza (np. z pliku
// formularza w narzedzia/przygotuj.mjs).

import { czytajKwote, czytajCene, czytajDziesietna, czytajTekstWolny, liczbaZCyfr } from "./kwoty.js";
import { poprawnaDoba, rokWZakresie } from "./kalendarz.js";

const LISTY = {
  sprzedawca: ["tauron_sprzedaz", "pge_obrot", "enea", "energa_obrot", "eon", "inny"],
  operator_dystrybucyjny: ["tauron_dystrybucja", "pge_dystrybucja", "enea_operator", "energa_operator", "stoen_operator", "inny"],
  taryfa: ["g11", "g12", "g12w", "g13", "inna"],
  rodzaj_faktury: ["rozliczeniowa", "korekta"],
  system_rozliczenia: ["net_billing_rce", "net_billing_rcem", "opusty", "nie_wiem"],
  rodzaj_ceny: ["stala", "dynamiczna"],
  magazyn: ["tak", "nie", "nie_wiem"],
  pierwsze_oddanie: ["przed_2024_07_01", "od_2024_07_01", "nie_wiem"],
  rodzaj_zmiany: ["pompa_ciepla", "samochod_elektryczny", "rozbudowa_pv"],
};

// Liczba stref taryfy; taryfa „inna” ma od 1 do 4 stref.
const STREFY = { g11: 1, g12: 2, g12w: 2, g13: 3 };
const MAKS_STREF_INNA = 4;

export const OBOWIAZKOWE_R = [
  "sprzedawca", "operator_dystrybucyjny", "taryfa", "okres_od", "okres_do", "rodzaj_faktury",
  "system_rozliczenia", "rodzaj_ceny", "cena_energii_netto_zl_kwh", "oplata_mocowa_zl_mies",
  "oplata_abonamentowa_zl_mies", "oplata_stala_sieciowa_zl_mies",
];

const pusty = (w) => w === undefined || w === null || (typeof w === "string" && w.trim() === "");

function czytajDate(tekst) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tekst.trim());
  if (!m) return { ok: false };
  const rok = liczbaZCyfr(m[1]);
  if (!rokWZakresie(rok) || !poprawnaDoba(rok, liczbaZCyfr(m[2]), liczbaZCyfr(m[3]))) return { ok: false };
  return { ok: true, wartosc: m[0] };
}

function czytajMiesiac(tekst) {
  const m = /^(\d{4})-(\d{2})$/.exec(tekst.trim());
  if (!m) return { ok: false };
  const rok = liczbaZCyfr(m[1]);
  const miesiac = liczbaZCyfr(m[2]);
  if (!rokWZakresie(rok) || miesiac < 1 || miesiac > 12) return { ok: false };
  return { ok: true, wartosc: m[0] };
}

function czytajFakture(f, bledy, brakujace) {
  const r = {};
  const wybor = (pole) => {
    if (pusty(f[pole])) return;
    if (LISTY[pole].includes(f[pole])) r[pole] = f[pole];
    else bledy.push({ pole, kod: "blad_wyboru" });
  };
  const pole = (nazwa, czytaj, kod) => {
    if (pusty(f[nazwa])) return;
    const w = typeof f[nazwa] === "string" ? czytaj(f[nazwa]) : { ok: false };
    if (w.ok) r[nazwa] = w.wartosc;
    else bledy.push({ pole: nazwa, kod });
  };

  wybor("sprzedawca");
  if (r.sprzedawca === "inny") pole("sprzedawca_nazwa", czytajTekstWolny, "tekst_wolny_blad");
  wybor("operator_dystrybucyjny");
  wybor("taryfa");
  if (r.taryfa === "inna") pole("taryfa_nazwa", czytajTekstWolny, "tekst_wolny_blad");
  pole("okres_od", czytajDate, "faktura_data_format");
  pole("okres_do", czytajDate, "faktura_data_format");
  if (r.okres_od && r.okres_do && r.okres_do < r.okres_od) {
    delete r.okres_do;
    bledy.push({ pole: "okres_do", kod: "faktura_okres" });
  }
  wybor("rodzaj_faktury");
  wybor("system_rozliczenia");
  wybor("rodzaj_ceny");

  let cena = f.cena_energii_netto_zl_kwh;
  // Taryfa „inna”: klient może dodać pole strefy i zostawić je puste; puste pola na końcu listy
  // się nie liczą. Puste pole w środku dalej jest błędem liczby stref.
  if (Array.isArray(cena) && r.taryfa === "inna") {
    let koniec = cena.length;
    while (koniec > 0 && pusty(cena[koniec - 1])) koniec -= 1;
    cena = cena.slice(0, koniec);
  }
  if (Array.isArray(cena)) {
    if (!cena.every(pusty)) {
      const liczba = STREFY[r.taryfa] ?? (r.taryfa === "inna" ? cena.length : 0);
      if (cena.some(pusty) || cena.length !== liczba || liczba > MAKS_STREF_INNA) {
        bledy.push({ pole: "cena_energii_netto_zl_kwh", kod: "faktura_strefy_liczba" });
      } else {
        const ceny = cena.map((c) => (typeof c === "string" ? czytajCene(c) : { ok: false }));
        const zle = ceny.findIndex((c) => !c.ok);
        if (zle >= 0) bledy.push({ pole: `cena_energii_netto_zl_kwh[${zle}]`, kod: "faktura_cena_format" });
        else r.cena_energii_netto_zl_kwh = ceny.map((c) => c.wartosc);
      }
    }
  } else {
    pole("cena_energii_netto_zl_kwh", czytajCene, "faktura_cena_format");
  }

  for (const nazwa of ["oplata_mocowa_zl_mies", "oplata_abonamentowa_zl_mies", "oplata_stala_sieciowa_zl_mies", "oplata_przejsciowa_zl_mies"]) {
    pole(nazwa, czytajKwote, "faktura_kwota_format");
  }

  const inne = [];
  (Array.isArray(f.oplaty_stale_inne) ? f.oplaty_stale_inne : []).forEach((o, i) => {
    const bezNazwy = pusty(o?.nazwa);
    const bezKwoty = pusty(o?.kwota_zl_mies);
    if (bezNazwy && bezKwoty) return;
    if (bezNazwy || bezKwoty) {
      bledy.push({ pole: `oplaty_stale_inne[${i}]`, kod: "faktura_oplata_niepelna" });
      return;
    }
    const nazwa = czytajTekstWolny(o.nazwa);
    const kwota = czytajKwote(o.kwota_zl_mies);
    if (!nazwa.ok) bledy.push({ pole: `oplaty_stale_inne[${i}].nazwa`, kod: "tekst_wolny_blad" });
    if (!kwota.ok) bledy.push({ pole: `oplaty_stale_inne[${i}].kwota_zl_mies`, kod: "faktura_kwota_format" });
    if (nazwa.ok && kwota.ok) inne.push({ nazwa: nazwa.wartosc, kwota_zl_mies: kwota.wartosc });
  });
  if (inne.length > 0) r.oplaty_stale_inne = inne;

  const wymagane = [...OBOWIAZKOWE_R];
  if (r.sprzedawca === "inny") wymagane.splice(1, 0, "sprzedawca_nazwa");
  if (r.taryfa === "inna") wymagane.splice(wymagane.indexOf("taryfa") + 1, 0, "taryfa_nazwa");
  const zBledem = new Set(bledy.map((b) => b.pole.replace(/\[.*$/, "")));
  for (const nazwa of wymagane) if (!(nazwa in r) && !zBledem.has(nazwa)) brakujace.push(nazwa);
  return r;
}

function czytajInstalacje(f, bledy) {
  const r = {};
  const liczba = (nazwa, opcje) => {
    if (pusty(f[nazwa])) return;
    const w = typeof f[nazwa] === "string" ? czytajDziesietna(f[nazwa], opcje) : { ok: false };
    if (w.ok) r[nazwa] = w.wartosc;
    else bledy.push({ pole: nazwa, kod: "instalacja_liczba_format" });
  };
  const wybor = (nazwa) => {
    if (pusty(f[nazwa])) return;
    if (LISTY[nazwa].includes(f[nazwa])) r[nazwa] = f[nazwa];
    else bledy.push({ pole: nazwa, kod: "blad_wyboru" });
  };

  liczba("moc_pv_kwp", { calkowitych: 3, miejsc: 2, dodatnia: true });
  wybor("magazyn");
  if (r.magazyn === "tak") {
    liczba("magazyn_pojemnosc_kwh", { calkowitych: 4, miejsc: 2, dodatnia: true });
    if (!pusty(f.magazyn_od)) {
      // Strona podaje wybór z dwóch list; „RRRR-” albo „-MM” znaczy, że wybrano tylko jedną część.
      const niepelny = typeof f.magazyn_od === "string" && /^(\d{4}-|-\d{2})$/.test(f.magazyn_od.trim());
      const m = typeof f.magazyn_od === "string" ? czytajMiesiac(f.magazyn_od) : { ok: false };
      if (m.ok) r.magazyn_od = m.wartosc;
      else bledy.push({ pole: "magazyn_od", kod: niepelny ? "instalacja_miesiac_niepelny" : "instalacja_miesiac_format" });
    }
  }
  wybor("pierwsze_oddanie");

  const zmiany = [];
  (Array.isArray(f.zmiany) ? f.zmiany : []).forEach((z, i) => {
    if (pusty(z?.rodzaj)) return;
    if (!LISTY.rodzaj_zmiany.includes(z.rodzaj)) {
      bledy.push({ pole: `zmiany[${i}]`, kod: "blad_wyboru" });
      return;
    }
    if (pusty(z.miesiac)) {
      bledy.push({ pole: `zmiany[${i}]`, kod: "instalacja_miesiac_brak" });
      return;
    }
    const m = typeof z.miesiac === "string" ? czytajMiesiac(z.miesiac) : { ok: false };
    if (!m.ok) {
      bledy.push({ pole: `zmiany[${i}]`, kod: "instalacja_miesiac_format" });
      return;
    }
    // Każdy rodzaj zmiany najwyżej raz.
    if (zmiany.some((x) => x.rodzaj === z.rodzaj)) {
      bledy.push({ pole: `zmiany[${i}]`, kod: "blad_wyboru" });
      return;
    }
    zmiany.push({ rodzaj: z.rodzaj, miesiac: m.wartosc });
  });
  if (zmiany.length > 0) r.zmiany = zmiany;
  return r;
}

// Budowa danych formularza z pliku (narzedzia/przygotuj.mjs). Strona zawsze buduje poprawny
// obiekt; plik pisany ręcznie może mieć literówkę w kluczu albo zły typ, a wtedy pole zostałoby
// po cichu pominięte. Zwraca ścieżkę pierwszego złego klucza (bez wartości) albo null.
const TEKST = "tekst";
const BUDOWA = {
  faktura: {
    sprzedawca: TEKST, sprzedawca_nazwa: TEKST, operator_dystrybucyjny: TEKST, taryfa: TEKST, taryfa_nazwa: TEKST,
    okres_od: TEKST, okres_do: TEKST, rodzaj_faktury: TEKST, system_rozliczenia: TEKST, rodzaj_ceny: TEKST,
    cena_energii_netto_zl_kwh: "tekst albo lista tekstów",
    oplata_mocowa_zl_mies: TEKST, oplata_abonamentowa_zl_mies: TEKST, oplata_stala_sieciowa_zl_mies: TEKST,
    oplata_przejsciowa_zl_mies: TEKST,
    oplaty_stale_inne: [{ nazwa: TEKST, kwota_zl_mies: TEKST }],
  },
  instalacja: {
    moc_pv_kwp: TEKST, magazyn: TEKST, magazyn_pojemnosc_kwh: TEKST, magazyn_od: TEKST, pierwsze_oddanie: TEKST,
    zmiany: [{ rodzaj: TEKST, miesiac: TEKST }],
  },
  zgoda: "logiczna",
};

const obiekt = (w) => w !== null && typeof w === "object" && !Array.isArray(w);

function sprawdzBudowe(wartosc, wzor, sciezka) {
  if (wzor === TEKST) return typeof wartosc === "string" ? null : sciezka;
  if (wzor === "logiczna") return typeof wartosc === "boolean" ? null : sciezka;
  if (wzor === "tekst albo lista tekstów") {
    if (typeof wartosc === "string") return null;
    if (!Array.isArray(wartosc)) return sciezka;
    const zly = wartosc.findIndex((w) => typeof w !== "string");
    return zly < 0 ? null : `${sciezka}[${zly}]`;
  }
  if (Array.isArray(wzor)) {
    if (!Array.isArray(wartosc)) return sciezka;
    for (let i = 0; i < wartosc.length; i++) {
      const blad = sprawdzBudowe(wartosc[i], wzor[0], `${sciezka}[${i}]`);
      if (blad) return blad;
    }
    return null;
  }
  if (!obiekt(wartosc)) return sciezka;
  for (const [klucz, w] of Object.entries(wartosc)) {
    const pelna = sciezka ? `${sciezka}.${klucz}` : klucz;
    if (!Object.hasOwn(wzor, klucz)) return pelna;
    const blad = sprawdzBudowe(w, wzor[klucz], pelna);
    if (blad) return blad;
  }
  return null;
}

export function bladBudowyFormularza(dane) {
  if (!obiekt(dane)) return "formularz";
  return sprawdzBudowe(dane, BUDOWA, "");
}

export function czytajFormularz(dane = {}) {
  const bledy = [];
  const brakujace = [];
  const raport = czytajFakture(dane.faktura ?? {}, bledy, brakujace);
  const instalacja = czytajInstalacje(dane.instalacja ?? {}, bledy);
  return { raport, instalacja, zgoda: dane.zgoda === true, bledy, brakujace };
}
