// Obsługa strony narzędzia. Cała logika danych jest w app/lib/ (bez DOM); tu tylko:
// odczyt plików wybranych przez klienta, zebranie pól formularza, pokazanie wyniku
// i zapis ZIP-a na urządzeniu. Teksty pochodzą wyłącznie z teksty.js i trafiają na stronę
// jako tekst (textContent), nigdy jako HTML. Nic nie jest wysyłane ani zapisywane
// w przeglądarce: po zamknięciu karty dane znikają.

import { TEKSTY } from "./teksty.js";
import { tekst, znacznikPolski, dataPolska, miesiacZRokiem, kwhDoWyswietlenia } from "./lib/odmiana.js";
import { przygotujPliki, zlozZgloszenie, odnosnikMailto, WERSJA } from "./lib/zgloszenie.js";
import { losowyNumer } from "./lib/numer.js";
import { LIMIT_BAJTOW } from "./lib/dekodowanie.js";
import { liczbaZCyfr } from "./lib/kwoty.js";

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
const ADRES_REPOZYTORIUM = `https://github.com/twiktorowicz/prosumentlab-anonimizator/releases/tag/v${WERSJA}`;
const pliki = []; // { nazwa, bajty | null (za duży) }
let przygotowane = null; // odczyt plików: liczony tylko przy zmianie listy plików
let wynik = null;
let odlozone = null;

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
    el("a", { href: "/prywatnosc/", target: "_blank", rel: "noopener", tekst: reszta.slice(poDwukropku).replace(/\.$/, "") }),
    reszta.endsWith(".") ? "." : "",
  );

  $("#numer").replaceChildren(...zdanieZNumerem());

  // Odnośnik do repozytorium na słowie z tekstu wersji („GitHubie”).
  const wersja = t("wersja", { wersja: WERSJA });
  const slowo = /GitHub\p{L}*/u.exec(wersja);
  if (slowo) {
    $("#wersja").replaceChildren(
      wersja.slice(0, slowo.index),
      el("a", { href: ADRES_REPOZYTORIUM, target: "_blank", rel: "noopener", tekst: slowo[0] }),
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
// przeglądarkach). Wartość RRRR-MM powstaje tylko, gdy wybrane są obie części.
function listyMiesiacaIRoku(nazwa) {
  const rokBiezacy = liczbaZCyfr(dzisiaj().slice(0, 4));
  const miesiac = el("select", { "aria-label": t("instalacja_miesiac"), "data-czesc": "miesiac" }, el("option", { value: "", tekst: t("instalacja_miesiac") }),
    ...TEKSTY.miesiace_mianownik.map((m, i) => el("option", { value: String(i + 1).padStart(2, "0"), tekst: m })));
  const lata = [];
  for (let r = rokBiezacy; r >= 2010; r--) lata.push(el("option", { value: String(r), tekst: String(r) }));
  const rok = el("select", { "aria-label": t("instalacja_rok"), "data-czesc": "rok" }, el("option", { value: "", tekst: t("instalacja_rok") }), ...lata);
  return el("div", { klasa: "miesiac-rok", "data-miesiac": nazwa }, miesiac, rok);
}

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

function zbudujPolaCen() {
  zapamietajCeny();
  const taryfa = wybrane("taryfa");
  const wieleStref = (STREFY[taryfa] ?? 0) > 1 || taryfa === "inna";
  pokaz($("#cena-tryb"), wieleStref);
  const strefy = wieleStref && wybrane("cena_tryb") === "strefy";
  const kontener = $("#cena-pola");
  if (strefy) {
    kontener.replaceChildren(...nazwyStref(taryfa).map((nazwa, i) => {
      const id = `p-cena-${i}`;
      const pole = el("input", { type: "text", id, inputmode: "decimal", autocomplete: "off", "data-strefa": String(i) });
      pole.value = wartosciCen.strefy[i] ?? "";
      return el("div", { klasa: "strefa" }, el("label", { for: id, tekst: nazwa }), pole);
    }));
  } else {
    const pole = el("input", { type: "text", id: "p-cena", inputmode: "decimal", autocomplete: "off", "aria-label": t("faktura_cena") });
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
    );
  }));
}

// Pola z warunkiem („sprzedawca=inny”) są widoczne tylko przy tej wartości.
function warunki() {
  for (const e of $$("[data-warunek]")) {
    const [pole, wartosc] = e.dataset.warunek.split("=");
    pokaz(e, wybrane(pole) === wartosc);
  }
  for (const z of $$("[data-zmiana]")) pokaz($(".miesiac-rok", z), $('input[type="checkbox"]', z).checked);
}

function zbierzFormularz() {
  const taryfa = wybrane("taryfa");
  const wieleStref = (STREFY[taryfa] ?? 0) > 1 || taryfa === "inna";
  const cena = wieleStref && wybrane("cena_tryb") === "strefy"
    ? $$("[data-strefa]").map((p) => p.value)
    : ($("#p-cena")?.value ?? "");
  const faktura = {
    sprzedawca: wybrane("sprzedawca"),
    sprzedawca_nazwa: wartoscPola("sprzedawca_nazwa"),
    operator_dystrybucyjny: wybrane("operator_dystrybucyjny"),
    taryfa,
    taryfa_nazwa: wartoscPola("taryfa_nazwa"),
    okres_od: wartoscPola("okres_od"),
    okres_do: wartoscPola("okres_do"),
    rodzaj_faktury: wybrane("rodzaj_faktury"),
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
    pierwsze_oddanie: wybrane("pierwsze_oddanie"),
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
function przeliczPliki() {
  przygotowane = przygotujPliki(pliki.filter((p) => p.bajty).map((p) => p.bajty));
}

async function dodajPliki(lista) {
  for (const plik of lista) {
    pliki.push({ nazwa: plik.name, bajty: plik.size > LIMIT_BAJTOW ? null : new Uint8Array(await plik.arrayBuffer()) });
  }
  przeliczPliki();
  przelicz();
}

function usunPlik(i) {
  pliki.splice(i, 1);
  przeliczPliki();
  przelicz();
}

// --- Wynik -----------------------------------------------------------------------------------

function komunikat(klasa, tresc) {
  return el("p", { klasa, tekst: tresc });
}

function tekstKodu(kod, wstawki = {}) {
  return kod in TEKSTY ? t(kod, wstawki) : t("blad_nieznany");
}

function pokazPliki() {
  // Pliki za duże nie trafiają do modułów; pozostałe mają wynik w kolejności przekazania.
  const czytelne = pliki.map((p, i) => ({ ...p, i })).filter((p) => p.bajty);
  const wynikDla = new Map(czytelne.map((p, j) => [p.i, wynik.pliki[j]]));
  $("#lista-plikow").replaceChildren(...pliki.map((plik, i) => {
    const w = wynikDla.get(i) ?? { stan: "odrzucony", kod: "blad_za_duzy" };
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
    const usun = el("button", { type: "button", klasa: "przycisk-tekstowy", tekst: t("plik_usun") });
    usun.addEventListener("click", () => usunPlik(i));
    return el("li", { klasa: `plik plik-${stan}` },
      el("div", { klasa: "plik-naglowek" },
        el("span", { klasa: "plik-nazwa", tekst: plik.nazwa }),
        el("span", { klasa: `plakietka plakietka-${stan}`, tekst: t(`plik_stan_${stan}`) }),
        usun),
      ...tresc);
  }));

  $("#blokady").replaceChildren(...wynik.blokady.filter((b) => b.plik === undefined).map((b) =>
    komunikat("blad", tekstKodu(b.kod, b.znacznik ? { data: znacznikPolski(b.znacznik) } : {}))));
}

const miesiacTekst = (rokMiesiac) => {
  const [r, m] = rokMiesiac.split("-").map(liczbaZCyfr);
  return miesiacZRokiem(r, m, TEKSTY.miesiace_dopelniacz);
};

function pokazZakres() {
  const kontener = $("#zakres");
  if (!wynik.pliki.some((p) => p.stan === "przyjety" || p.stan === "uwaga")) {
    kontener.replaceChildren();
    return;
  }
  const z = wynik.zakres;
  const elementy = [];
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
    const b = przyjete[i] && $(".blad", przyjete[i]);
    if (b) {
      b.textContent = t("instalacja_miesiac_poza_zakresem");
      b.hidden = false;
    }
  }
  pokaz($("#faktura-poza-zakresem"), wynik.uwagi.some((u) => u.kod === "FAKTURA_R_POZA_ZAKRESEM"));
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

function pokazPodglad() {
  const przyjete = wynik.pliki.filter((p) => p.nazwa).sort((a, b) => a.nazwa.localeCompare(b.nazwa, "pl", { numeric: true }));
  const czesci = [];
  if (przyjete.length > 0) {
    czesci.push(tabela(
      [t("podglad_plik"), t("podglad_wiersze"), t("podglad_pierwsza"), t("podglad_ostatnia"), t("podglad_usuniete")],
      przyjete.map((p) => [p.nazwa, String(p.wierszeDanych), znacznikPolski(p.pierwszyZnacznik), znacznikPolski(p.ostatniZnacznik), p.usunieteKolumny.join(", ")]),
      ["mono", "liczba", "", "", ""],
    ));
    for (const p of przyjete) {
      const plikWZip = wynik.zawartosc.find((z) => z.nazwa === p.nazwa);
      const naglowek = new TextDecoder().decode(plikWZip.bajty.subarray(0, plikWZip.bajty.indexOf(10)));
      czesci.push(el("h3", { tekst: `${t("podglad_pierwsze_wiersze")}, ${p.nazwa}` }), el("pre", { klasa: "wiersze", tekst: [naglowek, ...p.pierwszeWiersze].join("\n") }));
    }
    czesci.push(tabela(
      [t("podglad_miesiac"), t("podglad_pobrana"), t("podglad_oddana")],
      wynik.miesiace.map((m) => [`${TEKSTY.miesiace_mianownik[m.miesiac - 1]} ${m.rok}`, kwhDoWyswietlenia(m.poborWh), kwhDoWyswietlenia(m.oddanieWh)]),
      ["", "liczba", "liczba"],
    ));
  }
  for (const nazwa of ["faktury.json", "instalacja.json"]) {
    const plik = wynik.zawartosc.find((z) => z.nazwa === nazwa);
    if (plik) czesci.push(el("h3", { klasa: "mono", tekst: nazwa }), el("pre", { klasa: "wiersze", tekst: new TextDecoder().decode(plik.bajty) }));
  }
  czesci.push(komunikat("", t(wynik.zgoda ? "podglad_zgoda_tak" : "podglad_zgoda_nie")));
  czesci.push(el("p", { klasa: "numer" }, ...zdanieZNumerem()));
  czesci.push(el("h3", { tekst: t("podglad_lista_zip") }), el("ul", { klasa: "mono" }, ...wynik.zawartosc.map((z) => el("li", { tekst: z.nazwa }))));
  $("#podglad").replaceChildren(...czesci);
}

function pokazZapis() {
  const przycisk = $("#zapisz");
  przycisk.disabled = !wynik.moznaZapisac;
  const powod = $("#zapis-powod");
  let tresc = "";
  if (wynik.powod === "brak_plikow") tresc = t("zapis_brak_plikow");
  else if (wynik.powod === "blokada") tresc = t("zapis_blokada");
  else if (wynik.powod === "bledy_pol") {
    const nazwy = [...new Set(wynik.bledyPol.map((b) => b.pole.replace(/\[.*$/, "")))].map((p) => TEKSTY.pola_nazwy[p] ?? p);
    tresc = t("zapis_popraw", { pola: nazwy.join(", ") });
  }
  powod.textContent = tresc;
  pokaz(powod, Boolean(tresc));
}

// `poZapisie`: przeliczenie wywołane samym zapisem; każde inne chowa komunikat po zapisie
// i przycisk wiadomości, bo zapisany ZIP przestał odpowiadać danym na stronie.
function przelicz({ poZapisie = false } = {}) {
  clearTimeout(odlozone);
  warunki();
  if (!poZapisie) pokaz($("#po-zapisie"), false);
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
}

function przeliczPozniej() {
  clearTimeout(odlozone);
  odlozone = setTimeout(przelicz, 250);
}

function zapisz() {
  przelicz({ poZapisie: true });
  if (!wynik.moznaZapisac) return;
  const adres = URL.createObjectURL(new Blob([wynik.zip], { type: "application/zip" }));
  const a = el("a", { href: adres, download: wynik.nazwaZip });
  document.body.append(a);
  a.click();
  a.remove();
  // Adres pliku musi chwilę żyć, zwłaszcza w Safari na iOS.
  setTimeout(() => URL.revokeObjectURL(adres), 60000);
  $("#po-zapisie-tekst").textContent = t("po_zapisie", { plik: wynik.nazwaZip });
  $("#mailto").href = odnosnikMailto(t("mailto_temat", { numer: NUMER }), t("mailto_tresc", { plik: wynik.nazwaZip }));
  pokaz($("#po-zapisie"), true);
}

// --- Start -----------------------------------------------------------------------------------

function start() {
  wstawTeksty();
  zbudujOpcje();
  $('[data-miesiac="magazyn_od"]').replaceWith(listyMiesiacaIRoku("magazyn_od"));
  zbudujZmiany();
  dodajOplate();
  zbudujPolaCen();
  przeliczPliki();

  $("#wybor-plikow").addEventListener("change", async (z) => {
    await dodajPliki([...z.target.files]);
    z.target.value = "";
  });
  const main = $("main");
  main.addEventListener("input", przeliczPozniej);
  main.addEventListener("change", (z) => {
    if (z.target.name === "taryfa" || z.target.name === "cena_tryb") zbudujPolaCen();
    if (z.target.id !== "wybor-plikow") przelicz();
  });
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
  przelicz();
}

start();
