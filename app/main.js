// Obsługa strony narzędzia. Cała logika danych jest w app/lib/ (bez DOM); tu tylko:
// odczyt plików wybranych przez klienta, zebranie pól formularza, pokazanie wyniku
// i zapis ZIP-a na urządzeniu. Teksty pochodzą wyłącznie z teksty.js i trafiają na stronę
// jako tekst (textContent), nigdy jako HTML. Nic nie jest wysyłane ani zapisywane
// w przeglądarce: po zamknięciu karty dane znikają.

import { TEKSTY } from "./teksty.js";
import { tekst, znacznikPolski, dataPolska, miesiacZRokiem, kwhDoWyswietlenia } from "./lib/odmiana.js";
import { przygotujPliki, zlozZgloszenie, utworzZipZgloszenia, odnosnikMailto, nazwaZip, WERSJA, ADRES, MAKS_PLIKOW } from "./lib/zgloszenie.js";
import { losowyNumer } from "./lib/numer.js";
import { LIMIT_BAJTOW } from "./lib/dekodowanie.js";
import { liczbaZCyfr, czytajCene } from "./lib/kwoty.js";
import { ROK_MIN } from "./lib/kalendarz.js";
import { okresMiesiaca, sprzedawcaZListy } from "./lib/formularz.js";

const t = (klucz, wstawki) => tekst(TEKSTY, klucz, wstawki);
const $ = (wybor, w = document) => w.querySelector(wybor);
const $$ = (wybor, w = document) => [...w.querySelectorAll(wybor)];

function el(nazwa, atrybuty = {}, ...dzieci) {
  const e = document.createElement(nazwa);
  for (const [k, v] of Object.entries(atrybuty)) {
    if (k === "klasa") e.className = v;
    else if (k === "tekst") e.textContent = v;
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v !== undefined && v !== null) e.setAttribute(k, v);
  }
  e.append(...dzieci.filter((d) => d !== null && d !== undefined));
  return e;
}

const pokaz = (e, widoczny) => {
  e.hidden = !widoczny;
};

// --- Stan ------------------------------------------------------------------------------------

const NUMER = losowyNumer();
const ADRES_REPOZYTORIUM = `https://github.com/twiktorowicz/prosumentlab-przygotowanie-pliku/releases/tag/v${WERSJA}`;
// Pozycje listy plików w kolejności dodania: { nazwa, plik (File), bajty, stan }. Stan:
// "czeka" (jeszcze nie czytany), "wczytany", "za_duzy", "blad_odczytu". Czytane są tylko
// pozycje z pierwszej dziesiątki; dalsze nie trafiają do pamięci.
const pliki = [];
let czytanie = false; // trwa odczyt plików: dodawanie i usuwanie są nieaktywne
let przygotowane = null; // odczyt plików: liczony tylko przy zmianie listy plików
let wynikiPlikow = new Map(); // pozycja na liście -> wynik z przygotujPliki
let wynik = null;
let odlozone = null;
let czekaPrzeliczenie = false; // zmiana pola czeka na odłożone przeliczenie
// Udostępnianie odrzucone przez przeglądarkę innym błędem niż zamknięcie okna: do końca wizyty
// zostaje droga z zapisem.
let udostepnianieOdrzucone = false;
// Klient wybrał drogę z zapisem zamiast udostępniania: zostaje do końca wizyty.
let drogaZapisWybrana = false;
// Zapisy w tej wizycie: bajty ostatniego ZIP-a i to, czy kiedykolwiek zapisano ZIP o innej treści.
// Gdy treści były różne, każdy kolejny zapis różni się od co najmniej jednego wcześniejszego.
let poprzedniZapis = null;
let zapisanoRozne = false;

function dzisiaj() {
  const d = new Date();
  const dwie = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dwie(d.getMonth() + 1)}-${dwie(d.getDate())}`;
}

// --- Teksty stałe ----------------------------------------------------------------------------

function wstawTeksty() {
  for (const e of $$("[data-tekst]")) {
    const wartosc = TEKSTY[e.dataset.tekst];
    if (Array.isArray(wartosc)) e.replaceChildren(...wartosc.map((w) => el("li", { tekst: w })));
    else e.textContent = wartosc;
  }
  $("#rysunek-faktury").setAttribute("aria-label", t("faktura_rysunek_opis"));

  // Zgoda: odnośnik do informacji o przetwarzaniu danych stoi poza etykietą pola, żeby
  // dotknięcie go nie zaznaczało zgody.
  // Wszystkie słowa pochodzą z tekstu zgody; „Więcej: ” służy tylko jako znacznik podziału.
  const zgoda = t("zgoda");
  const podzial = zgoda.indexOf("Więcej: ");
  const reszta = zgoda.slice(podzial);
  const poDwukropku = reszta.indexOf(" ") + 1;
  $("#zgoda-etykieta").textContent = zgoda.slice(0, podzial).trimEnd();
  $("#zgoda-wiecej").replaceChildren(
    reszta.slice(0, poDwukropku),
    // Nowa karta: strona trzyma dane tylko w pamięci, więc przejście w tej samej karcie
    // skasowałoby wybrane pliki i formularz.
    el("a", { href: "/prywatnosc/", target: "_blank", rel: "noopener noreferrer", tekst: reszta.slice(poDwukropku).replace(/\.$/, "") }),
    reszta.endsWith(".") ? "." : "",
  );

  $("#numer").replaceChildren(...zdanieZNumerem());
  $("#mailto-bez-zalacznika").textContent = t("mailto_bez_zalacznika", { plik: nazwaZip(NUMER) });

  // Instrukcja pobrania pliku: odnośnik na słowach z tekstu, w nowej karcie (jak przy zgodzie).
  // Fraza służy tylko do znalezienia miejsca podziału; bez niej zostaje sam tekst.
  const instrukcja = t("plik_instrukcja");
  const fraza = "jak go pobrać z eLicznika";
  const miejsce = instrukcja.indexOf(fraza);
  $("#plik-instrukcja").replaceChildren(...(miejsce < 0 ? [instrukcja] : [
    instrukcja.slice(0, miejsce),
    el("a", { href: "/jak-pobrac-dane-z-elicznika/", target: "_blank", rel: "noopener noreferrer", tekst: fraza }),
    instrukcja.slice(miejsce + fraza.length),
  ]));

  // Odnośnik do repozytorium na słowie z tekstu wersji („GitHubie”).
  const wersja = t("wersja", { wersja: WERSJA });
  const slowo = /GitHub\p{L}*/u.exec(wersja);
  if (slowo) {
    $("#wersja").replaceChildren(
      wersja.slice(0, slowo.index),
      el("a", { href: ADRES_REPOZYTORIUM, target: "_blank", rel: "noopener noreferrer", tekst: slowo[0] }),
      wersja.slice(slowo.index + slowo[0].length),
    );
  } else {
    $("#wersja").textContent = wersja;
  }
}

// Zdanie z numerem zgłoszenia; czcionką o stałej szerokości jest tylko sam numer.
function zdanieZNumerem() {
  const [przed, po] = TEKSTY.numer.split("{numer}");
  return [przed, el("span", { klasa: "numer-zgloszenia", tekst: NUMER }), po];
}

// --- Pola formularza -------------------------------------------------------------------------

function zbudujOpcje() {
  for (const pole of $$("[data-opcje]")) {
    const nazwa = pole.dataset.pole;
    const opcje = TEKSTY[pole.dataset.opcje];
    $(".opcje", pole).replaceChildren(
      ...Object.entries(opcje).map(([wartosc, etykieta]) =>
        el("label", { klasa: "opcja" }, el("input", { type: "radio", name: nazwa, value: wartosc }), el("span", { tekst: etykieta })),
      ),
    );
  }
}

function wybrane(nazwa) {
  return $(`input[name="${nazwa}"]:checked`)?.value ?? "";
}

function wartoscPola(nazwa) {
  return $(`#p-${nazwa}`)?.value ?? "";
}

// Miesiąc i rok z dwóch list (pole <input type="month"> nie działa we wszystkich
// przeglądarkach). Wartość RRRR-MM powstaje tylko, gdy wybrane są obie części. Lata od bieżącego
// wstecz do `rokOd`; obie listy puste na starcie.
function listyMiesiacaIRoku(nazwa, rokOd = ROK_MIN) {
  const rokBiezacy = liczbaZCyfr(dzisiaj().slice(0, 4));
  const miesiac = el("select", { "aria-label": t("instalacja_miesiac"), "data-czesc": "miesiac" }, el("option", { value: "", tekst: t("instalacja_miesiac") }),
    ...TEKSTY.miesiace_mianownik.map((m, i) => el("option", { value: String(i + 1).padStart(2, "0"), tekst: m })));
  const lata = [];
  for (let r = rokBiezacy; r >= rokOd; r--) lata.push(el("option", { value: String(r), tekst: String(r) }));
  const rok = el("select", { "aria-label": t("instalacja_rok"), "data-czesc": "rok" }, el("option", { value: "", tekst: t("instalacja_rok") }), ...lata);
  return el("div", { klasa: "miesiac-rok", "data-miesiac": nazwa }, miesiac, rok);
}

// Miesiąc faktury: lata od początku net-billingu.
const ROK_FAKTURY_OD = 2022;

// Wartość RRRR-MM z dwóch list. Przy `niepelny` wybór tylko jednej części daje „RRRR-” albo
// „-MM”, co moduł formularza zgłasza jako instalacja_miesiac_niepelny (pole magazynu).
// Przy zmianach niepełny wybór to brak miesiąca (instalacja_miesiac_brak).
function wartoscMiesiaca(kontener, { niepelny = false } = {}) {
  const m = $('[data-czesc="miesiac"]', kontener).value;
  const r = $('[data-czesc="rok"]', kontener).value;
  if (m && r) return `${r}-${m}`;
  if (niepelny && (m || r)) return `${r}-${m}`;
  return "";
}

const STREFY = { g11: 1, g12: 2, g12w: 2, g13: 3 };
let strefInnej = 1;
const wartosciCen = { jedna: "", strefy: [] };

function nazwyStref(taryfa) {
  if (taryfa === "g12" || taryfa === "g12w") return TEKSTY.strefy_g12;
  if (taryfa === "g13") return TEKSTY.strefy_g13;
  return Array.from({ length: strefInnej }, (_, i) => t("strefa_inna", { n: i + 1 }));
}

function zapamietajCeny() {
  const jedna = $("#p-cena");
  if (jedna) wartosciCen.jedna = jedna.value;
  $$("[data-strefa]").forEach((p) => {
    wartosciCen.strefy[+p.dataset.strefa] = p.value;
  });
}

// Ceny w strefach tylko przy cenie stałej i taryfie z kilkoma strefami; przy cenie dynamicznej
// faktura podaje jedną średnią cenę.
function wyborStref() {
  const taryfa = wybrane("taryfa");
  const wieleStref = ((STREFY[taryfa] ?? 0) > 1 || taryfa === "inna") && wybrane("rodzaj_ceny") !== "dynamiczna";
  return { taryfa, wieleStref, strefy: wieleStref && wybrane("cena_tryb") === "strefy" };
}

function zbudujPolaCen() {
  zapamietajCeny();
  const { taryfa, wieleStref, strefy } = wyborStref();
  pokaz($("#cena-tryb"), wieleStref);
  const kontener = $("#cena-pola");
  if (strefy) {
    kontener.replaceChildren(...nazwyStref(taryfa).map((nazwa, i) => {
      const id = `p-cena-${i}`;
      const pole = el("input", { type: "text", id, inputmode: "decimal", autocomplete: "off", "data-strefa": String(i) });
      pole.value = wartosciCen.strefy[i] ?? "";
      return el("div", { klasa: "strefa" }, el("label", { for: id, tekst: nazwa }), pole);
    }));
  } else {
    const etykieta = t(wybrane("rodzaj_ceny") === "dynamiczna" ? "faktura_cena_dynamiczna" : "faktura_cena");
    const pole = el("input", { type: "text", id: "p-cena", inputmode: "decimal", autocomplete: "off", "aria-label": etykieta });
    pole.value = wartosciCen.jedna;
    kontener.replaceChildren(pole);
  }
  pokaz($("#dodaj-strefe"), strefy && taryfa === "inna" && strefInnej < 4);
  // G12 i G12w mają nazwane pola („dzienna”, „nocna”), więc kolejność wynika z nazw; przy taryfie
  // „inna” pola mają tylko numery i trzeba je wypełnić w kolejności z faktury.
  pokaz($("#strefy-kolejnosc"), strefy && taryfa === "inna");
}

const MAKS_OPLAT = 5;
function dodajOplate() {
  const lista = $("#oplaty-inne");
  const i = lista.children.length;
  if (i >= MAKS_OPLAT) return;
  const idN = `p-oplata-${i}-nazwa`;
  const idK = `p-oplata-${i}-kwota`;
  lista.append(el("div", { klasa: "oplata", "data-oplata": String(i) },
    el("div", { klasa: "pole-czesc" }, el("label", { for: idN, tekst: t("faktura_inne_nazwa") }), el("input", { type: "text", id: idN, maxlength: "60", autocomplete: "off", "data-czesc": "nazwa" })),
    el("div", { klasa: "pole-czesc" }, el("label", { for: idK, tekst: t("faktura_inne_kwota") }), el("input", { type: "text", id: idK, inputmode: "decimal", autocomplete: "off", "data-czesc": "kwota" })),
    el("p", { klasa: "blad", hidden: true }),
  ));
  pokaz($("#dodaj-oplate"), lista.children.length < MAKS_OPLAT);
}

function zbudujZmiany() {
  $("#zmiany").replaceChildren(...Object.entries(TEKSTY.opcje_zmiany).map(([rodzaj, etykieta], i) => {
    const id = `p-zmiana-${i}`;
    const miesiac = listyMiesiacaIRoku(`zmiany-${i}`);
    miesiac.hidden = true;
    return el("div", { klasa: "zmiana", "data-zmiana": String(i), "data-rodzaj": rodzaj },
      el("label", { klasa: "opcja" }, el("input", { type: "checkbox", id }), el("span", { tekst: etykieta })),
      miesiac,
      el("p", { klasa: "blad", hidden: true }),
      el("p", { klasa: "uwaga", hidden: true }),
    );
  }));
}

// Elementy z warunkiem „sprzedawca=inny” są widoczne tylko przy tej wartości, z warunkiem
// „system_rozliczenia!=opusty” przy każdej innej (także bez wyboru). Schowane pola zachowują
// wpisane wartości; to, czy trafiają do danych, rozstrzyga moduł formularza.
function warunki() {
  for (const e of $$("[data-warunek]")) {
    const [, pole, znak, wartosc] = /^([a-z_]+)(!?=)(.*)$/.exec(e.dataset.warunek);
    pokaz(e, (wybrane(pole) === wartosc) === (znak === "="));
  }
  pokaz($("#korekta-podpowiedz"), $("#p-korekta").checked);
  // Okres faktury: miesiąc z list albo, po zaznaczeniu pola wyboru, dwie daty. Schowane pola
  // zachowują wartości, więc odznaczenie wraca do wybranego miesiąca.
  const innyOkres = $("#p-okres-inny").checked;
  pokaz($("#okres-daty"), innyOkres);
  pokaz($('[data-pole="okres_miesiac"]'), !innyOkres);
  for (const z of $$("[data-zmiana]")) pokaz($(".miesiac-rok", z), $('input[type="checkbox"]', z).checked);
}

function zbierzFormularz() {
  const { taryfa, strefy } = wyborStref();
  const innyOkres = $("#p-okres-inny").checked;
  const cena = strefy ? $$("[data-strefa]").map((p) => p.value) : ($("#p-cena")?.value ?? "");
  const faktura = {
    sprzedawca: wybrane("sprzedawca"),
    sprzedawca_nazwa: wartoscPola("sprzedawca_nazwa"),
    taryfa,
    taryfa_nazwa: wartoscPola("taryfa_nazwa"),
    okres_miesiac: innyOkres ? "" : wartoscMiesiaca($('[data-miesiac="okres_miesiac"]'), { niepelny: true }),
    okres_od: innyOkres ? wartoscPola("okres_od") : "",
    okres_do: innyOkres ? wartoscPola("okres_do") : "",
    rodzaj_faktury: $("#p-korekta").checked ? "korekta" : "rozliczeniowa",
    system_rozliczenia: wybrane("system_rozliczenia"),
    rodzaj_ceny: wybrane("rodzaj_ceny"),
    cena_energii_netto_zl_kwh: cena,
    oplata_mocowa_zl_mies: wartoscPola("oplata_mocowa_zl_mies"),
    oplata_abonamentowa_zl_mies: wartoscPola("oplata_abonamentowa_zl_mies"),
    oplata_stala_sieciowa_zl_mies: wartoscPola("oplata_stala_sieciowa_zl_mies"),
    oplata_przejsciowa_zl_mies: wartoscPola("oplata_przejsciowa_zl_mies"),
    oplaty_stale_inne: $$("[data-oplata]").map((w) => ({
      nazwa: $('[data-czesc="nazwa"]', w).value,
      kwota_zl_mies: $('[data-czesc="kwota"]', w).value,
    })),
  };
  const instalacja = {
    moc_pv_kwp: wartoscPola("moc_pv_kwp"),
    magazyn: wybrane("magazyn"),
    magazyn_pojemnosc_kwh: wartoscPola("magazyn_pojemnosc_kwh"),
    magazyn_od: wartoscMiesiaca($('[data-miesiac="magazyn_od"]'), { niepelny: true }),
    zmiany: $$("[data-zmiana]").map((z) => ({
      rodzaj: $('input[type="checkbox"]', z).checked ? z.dataset.rodzaj : "",
      miesiac: wartoscMiesiaca($(".miesiac-rok", z)),
    })),
  };
  return { faktura, instalacja, zgoda: $("#p-zgoda").checked };
}

// --- Pliki -----------------------------------------------------------------------------------

// Odczyt plików, kolejność, zakres i blokady plików liczą się tylko tu, przy zmianie listy
// plików. Zmiana pola formularza tylko składa zgłoszenie z gotowego odczytu.
// Do modułów trafiają pliki wczytane z pierwszej dziesiątki listy. Gdyby przygotowanie
// wszystkich naraz rzuciło wyjątek, pliki są sprawdzane pojedynczo, a te, przy których wyjątek
// się powtarza, dostają blad_nieznany; pozostałe działają dalej.
const BEZ_PLIKOW = { pliki: [], przyjete: [], analiza: null, blokady: [] };

function sprobujPrzygotowac(pozycje) {
  try {
    return przygotujPliki(pozycje.map(({ p }) => p.bajty));
  } catch {
    return null;
  }
}

function przeliczPliki() {
  const doOdczytu = pliki.slice(0, MAKS_PLIKOW).map((p, i) => ({ p, i })).filter(({ p }) => p.stan === "wczytany");
  let wybrane = doOdczytu;
  let gotowe = sprobujPrzygotowac(wybrane);
  if (!gotowe) {
    wybrane = doOdczytu.filter((pozycja) => {
      if (sprobujPrzygotowac([pozycja])) return true;
      pozycja.p.stan = "blad_odczytu";
      return false;
    });
    gotowe = sprobujPrzygotowac(wybrane);
  }
  if (!gotowe) {
    for (const { p } of wybrane) p.stan = "blad_odczytu";
    wybrane = [];
    gotowe = BEZ_PLIKOW;
  }
  przygotowane = gotowe;
  wynikiPlikow = new Map(wybrane.map(({ i }, j) => [i, przygotowane.pliki[j]]));
}

function ustawBlokadeOdczytu() {
  $("#wybor-plikow").disabled = czytanie;
  for (const b of $$("#lista-plikow button")) b.disabled = czytanie;
}

// Czyta pozycje z pierwszej dziesiątki, które jeszcze nie są w pamięci. Plik większy niż limit
// nie jest czytany; błąd odczytu przez przeglądarkę daje blad_nieznany.
async function wczytajBrakujace() {
  for (const p of pliki.slice(0, MAKS_PLIKOW)) {
    if (p.stan !== "czeka") continue;
    if (p.plik.size > LIMIT_BAJTOW) {
      p.stan = "za_duzy";
      continue;
    }
    try {
      p.bajty = new Uint8Array(await p.plik.arrayBuffer());
      p.stan = "wczytany";
    } catch {
      p.stan = "blad_odczytu";
    }
  }
}

async function zmienListe(zmiana) {
  if (czytanie) return;
  czytanie = true;
  ustawBlokadeOdczytu();
  try {
    zmiana();
    await wczytajBrakujace();
  } finally {
    czytanie = false;
    przeliczPliki();
    przelicz();
  }
}

function dodajPliki(lista) {
  return zmienListe(() => {
    for (const plik of lista) pliki.push({ nazwa: plik.name, plik, bajty: null, stan: "czeka" });
  });
}

function usunPlik(i) {
  return zmienListe(() => {
    pliki.splice(i, 1);
  });
}

// --- Wynik -----------------------------------------------------------------------------------

function komunikat(klasa, tresc) {
  return el("p", { klasa, tekst: tresc });
}

function tekstKodu(kod, wstawki = {}) {
  return kod in TEKSTY ? t(kod, wstawki) : t("blad_nieznany");
}

// Stan pozycji, która nie trafiła do modułów.
function wynikBezOdczytu(plik, i) {
  if (i >= MAKS_PLIKOW) return { stan: "odrzucony", kod: "blad_za_duzo_plikow" };
  if (plik.stan === "za_duzy") return { stan: "odrzucony", kod: "blad_za_duzy" };
  return { stan: "odrzucony", kod: "blad_nieznany" };
}

function pokazPliki() {
  // Wynik z modułów ma tylko pozycja wczytana z pierwszej dziesiątki; pozostałe mają stan z listy.
  const wynikDla = new Map([...wynikiPlikow].map(([i, p]) => [i, wynik.pliki[p.indeks]]));
  $("#lista-plikow").replaceChildren(...pliki.map((plik, i) => {
    const w = wynikDla.get(i) ?? wynikBezOdczytu(plik, i);
    const stan = w.stan === "blokada" ? "odrzucony" : w.stan;
    const tresc = [];
    if (w.stan === "odrzucony" || w.stan === "blokada") {
      tresc.push(komunikat("blad", tekstKodu(w.kod, { wiersz: w.wiersz })));
    } else {
      tresc.push(komunikat("", t(w.wariant === "surowy" ? "plik_przyjety" : "plik_bez_numerow")));
      for (const u of w.uwagi ?? []) {
        tresc.push(komunikat("uwaga", u.kod === "UWAGA_KOMPLETNOSC" ? t("uwaga_kompletnosc", { n: u.n }) : t(u.kod.toLowerCase())));
      }
    }
    const usun = el("button", { type: "button", klasa: "przycisk-tekstowy", tekst: t("plik_usun"), disabled: czytanie });
    usun.addEventListener("click", () => usunPlik(i));
    return el("li", { klasa: `plik plik-${stan}` },
      el("div", { klasa: "plik-naglowek" },
        el("span", { klasa: "plik-nazwa", tekst: plik.nazwa }),
        el("span", { klasa: `plakietka plakietka-${stan}`, tekst: t(`plik_stan_${stan}`) }),
        usun),
      ...tresc);
  }));

  // Pod listą plików tylko blokady z plików; blokada z pól formularza stoi przy przycisku zapisu.
  $("#blokady").replaceChildren(...wynik.blokady.filter((b) => b.plik === undefined && b.kod !== BLOKADA_POL).map((b) =>
    komunikat("blad", tekstKodu(b.kod, b.znacznik ? { data: znacznikPolski(b.znacznik) } : {}))));
}

const miesiacTekst = (rokMiesiac) => {
  const [r, m] = rokMiesiac.split("-").map(liczbaZCyfr);
  return miesiacZRokiem(r, m, TEKSTY.miesiace_dopelniacz);
};

function pokazZakres() {
  const kontener = $("#zakres");
  if (!wynik.pliki.some((p) => p.stan === "przyjety" || p.stan === "uwaga")) {
    kontener.replaceChildren(komunikat("", t("zakres_pusty")));
    return;
  }
  const z = wynik.zakres;
  const elementy = [];
  if (wynik.uwagaBezNumerow) elementy.push(komunikat("uwaga", t("uwaga_bez_numerow")));
  if (z.ciag_miesiace === 0) elementy.push(komunikat("", t("zakres_brak")));
  else {
    const klucz = { raport: "zakres_raport", wynik_wstepny: "zakres_wstepny", za_krotki: "zakres_za_krotki" }[z.klasyfikacja];
    elementy.push(komunikat("", t(klucz, { n: z.ciag_miesiace, od: miesiacTekst(z.ciag_od), do: miesiacTekst(z.ciag_do) })));
  }
  for (const u of wynik.uwagi.filter((x) => x.gdzie === "zakres")) {
    if (u.kod === "ZAKRES_TARYFA") {
      elementy.push(komunikat("uwaga", t("zakres_taryfa", { od: miesiacZRokiem(u.od.rok, u.od.miesiac, TEKSTY.miesiace_dopelniacz) })));
    } else if (u.kod in { ZAKRES_NIEPELNY: 1, ZAKRES_PRZERWA: 1, ZAKRES_LUKA: 1 }) {
      elementy.push(komunikat("uwaga", t(u.kod.toLowerCase(), { od: dataPolska(u.od), do: dataPolska(u.do) })));
    }
  }
  kontener.replaceChildren(...elementy);
}

// Komunikat błędu przy polu. `pole` z modułu formularza, np. "oplaty_stale_inne[2].nazwa".
function kontenerBledu(pole) {
  const m = /^(oplaty_stale_inne|zmiany)\[(\d+)\]/.exec(pole);
  if (m) {
    const wiersz = m[1] === "zmiany" ? $(`[data-zmiana="${m[2]}"]`) : $(`[data-oplata="${m[2]}"]`);
    return wiersz ? $(".blad", wiersz) : null;
  }
  const nazwa = pole.replace(/\[.*$/, "");
  const kontener = $(`[data-pole="${nazwa}"]`);
  return kontener ? $(":scope > .blad", kontener) : null;
}

function pokazPola() {
  for (const b of $$(".blad", $("main"))) {
    if (b.closest("#lista-plikow") || b.closest("#blokady")) continue;
    b.hidden = true;
    b.textContent = "";
  }
  for (const u of $$("[data-zmiana] .uwaga")) {
    u.hidden = true;
    u.textContent = "";
  }
  for (const { pole, kod } of wynik.bledyPol) {
    const b = kontenerBledu(pole);
    if (!b || !(kod in TEKSTY)) continue;
    const tresc = t(kod);
    if (!b.textContent.includes(tresc)) b.textContent = b.textContent ? `${b.textContent} ${tresc}` : tresc;
    b.hidden = false;
  }
  // Uwaga o miesiącu zmiany poza zakresem plików: indeks z listy przyjętych zmian.
  const przyjete = $$("[data-zmiana]").filter((z) =>
    $('input[type="checkbox"]', z).checked && wartoscMiesiaca($(".miesiac-rok", z)) &&
    !wynik.bledyPol.some((b) => b.pole === `zmiany[${z.dataset.zmiana}]`));
  for (const u of wynik.uwagi.filter((x) => x.kod === "INSTALACJA_MIESIAC_POZA_ZAKRESEM")) {
    const i = liczbaZCyfr(/\[(\d+)\]/.exec(u.gdzie)[1]);
    // Uwaga nie blokuje zapisu, więc ma styl uwagi, nie błędu.
    const miejsce = przyjete[i] && $(".uwaga", przyjete[i]);
    if (miejsce) {
      miejsce.textContent = t("instalacja_miesiac_poza_zakresem");
      miejsce.hidden = false;
    }
  }
  pokaz($("#faktura-poza-zakresem"), wynik.uwagi.some((u) => u.kod === "FAKTURA_R_POZA_ZAKRESEM"));
  pokaz($("#faktura-okres-dlugi"), wynik.uwagi.some((u) => u.kod === "FAKTURA_OKRES_DLUGI"));
  pokaz($("#faktura-cena-nietypowa"), wynik.uwagi.some((u) => u.kod === "FAKTURA_CENA_NIETYPOWA"));
  // Sprzedawca z listy wpisany w polu „inny”: tylko podpowiedź, bez blokady i bez wpisu do plików.
  pokaz($("#sprzedawca-na-liscie"), wybrane("sprzedawca") === "inny" && sprzedawcaZListy(wartoscPola("sprzedawca_nazwa")));
  // Pojemność magazynu nie jest obowiązkowa: przy „tak” i pustym polu tylko uwaga, bez blokady.
  pokaz($("#pojemnosc-brak"), wybrane("magazyn") === "tak" && !wartoscPola("magazyn_pojemnosc_kwh").trim());
  // Uwaga o brakujących polach dopiero wtedy, gdy narzędzie przyjęło co najmniej jeden plik.
  const jestPlik = wynik.pliki.some((p) => p.stan === "przyjety" || p.stan === "uwaga");
  const brak = jestPlik && wynik.uwagi.find((u) => u.kod === "FAKTURA_BRAK_OBOWIAZKOWYCH");
  const brakEl = $("#faktura-brak");
  brakEl.textContent = brak ? t("faktura_brak_obowiazkowych", { pola: brak.pola.map((p) => TEKSTY.pola_nazwy[p] ?? p).join(", ") }) : "";
  pokaz(brakEl, Boolean(brak));
}

function tabela(naglowki, wiersze, klasy = []) {
  return el("div", { klasa: "tabela-przewijana" }, el("table", {},
    el("thead", {}, el("tr", {}, ...naglowki.map((n, i) => el("th", { scope: "col", klasa: klasy[i] ?? "", tekst: n })))),
    el("tbody", {}, ...wiersze.map((w) => el("tr", {}, ...w.map((k, i) => el("td", { klasa: klasy[i] ?? "", tekst: k })))))));
}

// Opis pliku na liście zawartości ZIP-a. Nazwa pliku z urządzenia klienta stoi tylko na stronie;
// do ZIP-a nie trafia.
function opisPlikuZip(nazwa, zrodlo) {
  if (nazwa === "zgloszenie.json") return t("opis_zgloszenie");
  if (nazwa === "faktury.json") return t("opis_faktury");
  if (nazwa === "instalacja.json") return t("opis_instalacja");
  return t("opis_pomiary", { nazwa: zrodlo.get(nazwa) ?? "" });
}

// Zawartość pozycji na liście: plik JSON w całości; plik pomiarów jako liczba wierszy, pierwsza
// i ostatnia godzina, usunięte kolumny i pierwsze wiersze (nagłówek z pliku w ZIP-ie).
function trescPliku(plikWZip, odczyt, dekoder) {
  if (!odczyt) return [el("pre", { klasa: "wiersze", tekst: dekoder.decode(plikWZip.bajty) })];
  const naglowek = dekoder.decode(plikWZip.bajty.subarray(0, plikWZip.bajty.indexOf(10)));
  const dane = [
    [t("podglad_wiersze"), String(odczyt.wierszeDanych)],
    [t("podglad_pierwsza"), znacznikPolski(odczyt.pierwszyZnacznik)],
    [t("podglad_ostatnia"), znacznikPolski(odczyt.ostatniZnacznik)],
  ];
  if (odczyt.usunieteKolumny.length > 0) dane.push([t("podglad_usuniete"), odczyt.usunieteKolumny.join(", ")]);
  return [
    el("dl", { klasa: "dane-pliku" }, ...dane.flatMap(([nazwa, wartosc]) => [el("dt", { tekst: nazwa }), el("dd", { tekst: wartosc })])),
    el("p", { klasa: "drobny", tekst: t("podglad_pierwsze_wiersze") }),
    el("pre", { klasa: "wiersze", tekst: [naglowek, ...odczyt.pierwszeWiersze].join("\n") }),
  ];
}

// Podgląd zwarty: lista plików w kolejności z ZIP-a, każdy zwinięty, i osobno zwinięta tabela
// miesięcy. Pozycje rozwinięte przez klienta zostają rozwinięte po przeliczeniu; kluczem jest
// nazwa pliku w ZIP-ie, a dla tabeli miesięcy "miesiace".
function pokazPodglad() {
  const otwarte = new Set($$("#podglad details[data-plik]").filter((d) => d.open).map((d) => d.dataset.plik));
  const odczyty = new Map(wynik.pliki.filter((p) => p.nazwa).map((p) => [p.nazwa, p]));
  // pomiary_N.csv -> nazwa pliku z listy, z którego powstał.
  const pozycja = new Map([...wynikiPlikow].map(([i, p]) => [p.indeks, i]));
  const zrodlo = new Map([...odczyty].map(([nazwa, p]) => [nazwa, pliki[pozycja.get(p.indeks)]?.nazwa ?? ""]));
  const dekoder = new TextDecoder();
  const czesci = [
    komunikat("", t("podglad_wstep")),
    komunikat("", t(wynik.zgoda ? "podglad_zgoda_tak" : "podglad_zgoda_nie")),
    el("ul", { klasa: "lista-zip" }, ...wynik.zawartosc.map((z) => el("li", {},
      el("details", { klasa: "plik-zip", "data-plik": z.nazwa },
        el("summary", {}, el("span", { klasa: "mono", tekst: z.nazwa }), el("span", { klasa: "opis-pliku", tekst: opisPlikuZip(z.nazwa, zrodlo) })),
        ...trescPliku(z, odczyty.get(z.nazwa), dekoder))))),
  ];
  if (wynik.miesiace.length > 0) {
    czesci.push(el("details", { klasa: "miesiace", "data-plik": "miesiace" },
      el("summary", { tekst: t("podglad_miesiace_tytul") }),
      tabela(
        [t("podglad_miesiac"), t("podglad_pobrana"), t("podglad_oddana")],
        wynik.miesiace.map((m) => [`${TEKSTY.miesiace_mianownik[m.miesiac - 1]} ${m.rok}`, kwhDoWyswietlenia(m.poborWh), kwhDoWyswietlenia(m.oddanieWh)]),
        ["", "liczba", "liczba"],
      )));
  }
  $("#podglad").replaceChildren(...czesci);
  for (const d of $$("#podglad details[data-plik]")) if (otwarte.has(d.dataset.plik)) d.open = true;
}

// Blokada z pól wpisanych ręcznie (bezpiecznik plików JSON).
const BLOKADA_POL = "blad_bezpiecznik_formularz";

function pokazZapis() {
  const przycisk = $("#zapisz");
  przycisk.disabled = !wynik.moznaZapisac;
  const powod = $("#zapis-powod");
  let tresc = "";
  if (wynik.powod === "brak_plikow") tresc = t("zapis_brak_plikow");
  // Przy blokadzie z pól komunikat o polach stoi przy przycisku, także gdy pliki mają własną
  // blokadę (ta jest wtedy opisana pod listą plików).
  else if (wynik.powod === "blokada" && wynik.blokady.some((b) => b.kod === BLOKADA_POL)) tresc = t(BLOKADA_POL);
  else if (wynik.powod === "blokada") tresc = t("zapis_blokada");
  else if (wynik.powod === "bledy_pol") {
    const nazwy = [...new Set(wynik.bledyPol.map((b) => b.pole.replace(/\[.*$/, "")))].map((p) => TEKSTY.pola_nazwy[p] ?? p);
    tresc = t("zapis_popraw", { pola: nazwy.join(", ") });
  }
  powod.textContent = tresc;
  pokaz(powod, Boolean(tresc));

  // Droga wysyłki: z udostępnianiem tylko na ekranie dotykowym, gdy przeglądarka umie udostępnić
  // plik ZIP, aż do odmowy udostępniania albo wyboru drogi z zapisem. W pozostałych przypadkach
  // (komputer, przeglądarka bez udostępniania) droga z zapisem: krok 1 zapis, krok 2 wiadomość.
  // Liczone przy każdym przeliczeniu, bo rodzaj wskaźnika może się zmienić w trakcie wizyty.
  const drogaUdostepniania = mozeUdostepnic(PLIK_PROBNY) && matchMedia("(pointer: coarse)").matches && !udostepnianieOdrzucone && !drogaZapisWybrana;
  pokaz($("#droga-udostepnianie"), drogaUdostepniania);
  pokaz($("#droga-zapis"), !drogaUdostepniania);
  $("#udostepnij-przycisk").disabled = !wynik.moznaZapisac;
  pokaz($("#udostepnij-niedostepne"), udostepnianieOdrzucone);
}

// Droga z zapisem do końca wizyty: po wyborze klienta albo po odmowie udostępniania. Fokus
// przechodzi na przycisk zapisu, bo przycisk, który go miał, właśnie znika.
function pokazDrogeZapisu() {
  drogaZapisWybrana = true;
  przejdzDoZapisu();
}

function przejdzDoZapisu() {
  pokaz($("#droga-udostepnianie"), false);
  pokaz($("#droga-zapis"), true);
  pokaz($("#udostepnij-niedostepne"), udostepnianieOdrzucone);
  $("#zapisz").focus();
}

// Krok 2: „Napisz nową wiadomość” to odnośnik do wiadomości, aktywny dopiero po zapisie. Bez
// adresu (przed zapisem i po każdej zmianie danych) odnośnik nie ma href, ma aria-disabled i opis
// mailto_najpierw_zapisz, widoczny wtedy pod nim.
function ustawWiadomosc(mailto) {
  const m = $("#mailto");
  if (mailto) {
    m.setAttribute("href", mailto);
    m.removeAttribute("aria-disabled");
    m.removeAttribute("aria-describedby");
  } else {
    m.removeAttribute("href");
    m.setAttribute("aria-disabled", "true");
    m.setAttribute("aria-describedby", "mailto-najpierw-zapisz");
  }
  pokaz($("#mailto-najpierw-zapisz"), !mailto);
}

// Potwierdzenie zapisu, komunikat po zapisie i aktywna wiadomość dotyczą zapisanego ZIP-a; po
// zmianie danych przestają mu odpowiadać, więc znikają, a wiadomość znów czeka na zapis.
function schowajPotwierdzenieZapisu() {
  pokaz($("#zapis-gotowe"), false);
  pokaz($("#zapis-ponownie"), false);
  pokaz($("#po-zapisie"), false);
  ustawWiadomosc(null);
}

// `poZapisie`: przeliczenie wywołane samym zapisem; każde inne chowa potwierdzenie zapisu.
// Zapis niemożliwy chowa je zawsze, także przy zapisie: kliknięcie zapisu tuż po wpisaniu błędnej
// wartości nie może zostawić potwierdzenia i wiadomości do starego pliku.
function przelicz({ poZapisie = false } = {}) {
  clearTimeout(odlozone);
  czekaPrzeliczenie = false;
  warunki();
  if (!poZapisie) schowajPotwierdzenieZapisu();
  try {
    wynik = zlozZgloszenie({
      przygotowane,
      formularz: zbierzFormularz(),
      numer: NUMER,
      utworzono: dzisiaj(),
    });
    pokazPliki();
    pokazZakres();
    pokazPola();
    pokazPodglad();
    pokazZapis();
  } catch (blad) {
    // Błąd zostaje w konsoli przeglądarki (lokalnie, nic nie jest wysyłane), żeby dało się go
    // znaleźć; komunikaty modułów nie zawierają danych z plików.
    console.error(blad);
    pokazBladLogiki();
  }
  if (!wynik?.moznaZapisac) schowajPotwierdzenieZapisu();
  ustawBlokadeOdczytu();
}

// Wyjątek z logiki nie unieruchamia strony: zapis jest zablokowany z ogólnym komunikatem,
// a każda kolejna zmiana pola albo listy plików liczy wszystko od nowa.
function pokazBladLogiki() {
  wynik = null;
  $("#blokady").replaceChildren(komunikat("blad", t("blad_nieznany")));
  $("#zapisz").disabled = true;
  $("#udostepnij-przycisk").disabled = true;
  schowajPotwierdzenieZapisu();
  const powod = $("#zapis-powod");
  powod.textContent = t("zapis_blokada");
  pokaz(powod, true);
}

// Zmiana pola przelicza zgłoszenie po 250 ms, ale potwierdzenie zapisu znika od razu: zapisany
// ZIP już nie odpowiada danym na stronie.
function przeliczPozniej() {
  clearTimeout(odlozone);
  czekaPrzeliczenie = true;
  schowajPotwierdzenieZapisu();
  odlozone = setTimeout(przelicz, 250);
}

// „Inny okres” po wybranym miesiącu: puste pola dat dostają pierwszy i ostatni dzień tego
// miesiąca. Wpisanych dat nie zmienia; bez pełnego wyboru miesiąca i roku nic nie robi.
function wpiszDatyZMiesiaca() {
  const od = $("#p-okres_od");
  const doDnia = $("#p-okres_do");
  const okres = okresMiesiaca(wartoscMiesiaca($('[data-miesiac="okres_miesiac"]')));
  if (!okres || od.value || doDnia.value) return;
  od.value = okres.od;
  doDnia.value = okres.do;
}

// Cena po wyjściu z pola: poprawna wartość w postaci z co najmniej dwoma miejscami i przecinkiem
// („1” -> „1,00”); błędna zostaje tak, jak ją wpisano, przy niej stoi komunikat.
function uzupelnijCene(pole) {
  const c = czytajCene(pole.value);
  if (c.ok) pole.value = c.wartosc.replace(".", ",");
}

// Zmiana pola (zdarzenie change, u pól tekstowych po wyjściu z pola): reakcje zależne od pola,
// potem przeliczenie od razu.
function zmianaPola(z) {
  const pole = z.target;
  if (pole.id === "wybor-plikow") return;
  // Pstryk sprzedaje dziś tylko w cenie dynamicznej. Klient może ją zmienić, a zmiana sprzedawcy
  // niczego nie kasuje.
  if (pole.name === "sprzedawca" && pole.value === "pstryk") $('input[name="rodzaj_ceny"][value="dynamiczna"]').checked = true;
  if (pole.id === "p-okres-inny" && pole.checked) wpiszDatyZMiesiaca();
  if (pole.matches("#p-cena, [data-strefa]")) uzupelnijCene(pole);
  if (["taryfa", "cena_tryb", "rodzaj_ceny", "sprzedawca"].includes(pole.name)) zbudujPolaCen();
  przelicz();
}

function zapisz() {
  przelicz({ poZapisie: true });
  if (!wynik?.moznaZapisac) return;
  // Archiwum powstaje dopiero tu; zmiana pola formularza go nie buduje.
  const zip = utworzZipZgloszenia(wynik);
  const adres = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  const a = el("a", { href: adres, download: wynik.nazwaZip });
  document.body.append(a);
  a.click();
  a.remove();
  // Adres pliku musi chwilę żyć, zwłaszcza w Safari na iOS.
  setTimeout(() => URL.revokeObjectURL(adres), 60000);

  if (poprzedniZapis && !rowneBajty(poprzedniZapis, zip)) zapisanoRozne = true;
  poprzedniZapis = zip;
  $("#zapis-gotowe").textContent = t("zapis_gotowe", { plik: wynik.nazwaZip });
  pokaz($("#zapis-gotowe"), true);
  pokaz($("#zapis-ponownie"), zapisanoRozne);

  // Adres w tekście po zapisie i „Napisz nową wiadomość” prowadzą do tej samej wiadomości.
  const mailto = odnosnikMailto(t("mailto_temat", { numer: NUMER }), t("mailto_tresc", { plik: wynik.nazwaZip }));
  const [przed, po] = t("po_zapisie", { plik: wynik.nazwaZip }).split(ADRES);
  $("#po-zapisie").replaceChildren(...(po === undefined ? [przed] : [przed, el("a", { href: mailto, tekst: ADRES }), po]));
  pokaz($("#po-zapisie"), true);
  ustawWiadomosc(mailto);
}

function rowneBajty(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Systemowe okno udostępniania z plikiem w załączniku. Przeglądarka pozwala na nie zwykle tylko
// na stronie z HTTPS; bez tego przycisku nie ma, a zostaje wiadomość bez załącznika. Obsługę
// sprawdza pusty plik o tej samej nazwie i typie co ZIP zgłoszenia.
const PLIK_PROBNY = new File([], "zgloszenie.zip", { type: "application/zip" });
function mozeUdostepnic(plik) {
  try {
    return typeof navigator.canShare === "function" && Boolean(navigator.canShare({ files: [plik] }));
  } catch {
    return false;
  }
}

// ZIP powstaje przy kliknięciu z danych na stronie, bez wcześniejszego zapisu. Okno udostępniania
// wymaga gestu użytkownika, więc przed share() nie ma await. Odmowa inna niż zamknięcie okna
// (Chromium nie udostępnia plików ZIP) przełącza do końca wizyty na drogę z zapisem z komunikatem.
async function udostepnij() {
  if (czekaPrzeliczenie) przelicz();
  if (!wynik?.moznaZapisac || udostepnianieOdrzucone) return;
  // Adres do schowka, żeby wkleić go w polu „Do”. Bez czekania na wynik, bo share() musi być
  // wywołane w tym samym geście. Brak schowka albo odmowa niczego nie zmienia: adres jest też
  // w treści wiadomości.
  try {
    navigator.clipboard.writeText(ADRES).catch(() => {});
  } catch {
    // przeglądarka bez schowka
  }
  const plik = new File([utworzZipZgloszenia(wynik)], wynik.nazwaZip, { type: "application/zip" });
  try {
    await navigator.share({ files: [plik], title: t("udostepnij_tytul", { numer: NUMER }), text: t("udostepnij_tekst", { numer: NUMER }) });
  } catch (blad) {
    // AbortError: klient zamknął okno udostępniania bez wyboru aplikacji; to nie błąd.
    if (blad?.name === "AbortError") return;
    udostepnianieOdrzucone = true;
    przejdzDoZapisu();
  }
}

// --- Start -----------------------------------------------------------------------------------

function start() {
  wstawTeksty();
  zbudujOpcje();
  $('[data-miesiac="okres_miesiac"]').replaceWith(listyMiesiacaIRoku("okres_miesiac", ROK_FAKTURY_OD));
  $('[data-miesiac="magazyn_od"]').replaceWith(listyMiesiacaIRoku("magazyn_od"));
  zbudujZmiany();
  dodajOplate();
  zbudujPolaCen();
  przeliczPliki();

  $("#wybor-plikow").addEventListener("change", async (z) => {
    const lista = [...z.target.files];
    z.target.value = "";
    await dodajPliki(lista);
  });
  const main = $("main");
  main.addEventListener("input", przeliczPozniej);
  main.addEventListener("change", zmianaPola);
  $("#dodaj-strefe").addEventListener("click", () => {
    strefInnej = Math.min(4, strefInnej + 1);
    zbudujPolaCen();
    przelicz();
  });
  $("#dodaj-oplate").addEventListener("click", () => {
    dodajOplate();
    przelicz();
  });
  $("#zapisz").addEventListener("click", zapisz);
  $("#udostepnij-przycisk").addEventListener("click", udostepnij);
  $("#droga-zapis-pokaz").addEventListener("click", pokazDrogeZapisu);
  przelicz();
}

start();
