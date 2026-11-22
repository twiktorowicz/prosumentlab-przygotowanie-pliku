// Obsługa strony narzędzia. Cała logika danych jest w app/lib/ (bez DOM); tu tylko:
// odczyt plików wybranych przez klienta, zebranie pól formularza, kreator z sześcioma krokami,
// pokazanie wyniku, zapis ZIP-a na urządzeniu i wysyłka zgłoszenia. Teksty pochodzą wyłącznie
// z teksty.js i trafiają na stronę jako tekst (textContent), nigdy jako HTML. Strona wysyła
// tylko zgłoszenie: jedno żądanie pod /zgloszenie/ po wybraniu „Wyślij zgłoszenie” (wyslij).
// Niczego nie zapisuje w przeglądarce: po zamknięciu karty dane znikają.

import { TEKSTY } from "./teksty.js";
import { tekst, znacznikPolski, dataPolska, miesiacZRokiem, kwhDoWyswietlenia, rozmiarDoWyswietlenia } from "./lib/odmiana.js";
import { przygotujPliki, zlozZgloszenie, utworzZipZgloszenia, odnosnikMailto, nazwaZip, WERSJA, ADRES, MAKS_PLIKOW } from "./lib/zgloszenie.js";
import { losowyNumer } from "./lib/numer.js";
import { LIMIT_BAJTOW } from "./lib/dekodowanie.js";
import { liczbaZCyfr, czytajCene, zeroPrzedPrzecinkiem } from "./lib/kwoty.js";
import { ROK_MIN } from "./lib/kalendarz.js";
import { okresMiesiaca, sprzedawcaZListy, STREFY_KOLEJNOSC } from "./lib/formularz.js";
import { miesiaceFaktury } from "./lib/zakres.js";
import { sprawdzAdres, wysylkaDostepna, zipZaDuzy, wynikWysylki, sekundyCzekania, CZAS_WYSYLKI_MS } from "./lib/wysylka.js";

const t = (klucz, wstawki) => tekst(TEKSTY, klucz, wstawki);
// Bez drugiego argumentu szukają w całym dokumencie. Obiekt dokumentu nie trafia do parametru,
// bo test statyczny zakazuje go pod inną nazwą.
const $ = (wybor, w) => (w === undefined ? document.querySelector(wybor) : w.querySelector(wybor));
const $$ = (wybor, w) => [...(w === undefined ? document.querySelectorAll(wybor) : w.querySelectorAll(wybor))];

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

// Kreator: sześć kroków na jednej stronie, widoczny jeden. Stan tylko w pamięci; przycisk „wstecz”
// przeglądarki nie zmienia kroku (bez historii przeglądarki).
const KROKI = 6;
let aktualnyKrok = 1;
// Widok kroku 6: "wysylka" (adres i przycisk wysyłki), "zapasowa" (zapis pliku i wiadomość),
// "wyslane" (ekran po wysłaniu).
let widok6 = "wysylka";
// Wysyłka przez stronę działa pod https: i na serwerze próbnym (http: na 127.0.0.1 albo localhost).
const WYSYLKA_DOSTEPNA = wysylkaDostepna(location.protocol, location.hostname);

// ZIP przygotowany po wejściu na krok 5: { wynik, bajty } dla zgłoszenia `wynik`. Każda zmiana
// danych go unieważnia; zapis, odnośnik do wiadomości i wysyłka używają tego samego ZIP-a, więc
// kliknięcie nie czeka na kompresję.
let zip = null;
let budowanyDla = null; // zgłoszenie, dla którego trwa kompresja
// Zgłoszenie, dla którego budowa ZIP-a się nie udała (żadną metodą): krok 6 pokazuje zip_blad,
// a kolejne wejście na krok 5 albo 6 ponawia próbę.
let bladZipu = null;
// Zgłoszenie z tym ZIP-em zostało zapisane albo wysłane: bez pytania przed opuszczeniem strony.
let oddane = false;
let wysylkaTrwa = false;
let bladWysylki = null; // klucz tekstu po nieudanej wysyłce
let wyslanyAdres = "";
let wyslanePotwierdzenie = true;
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
  $("#wysylka-co").replaceChildren(...zdanieZNumerem("wysylka_co"));
  $("#mailto-bez-zalacznika").textContent = t("mailto_bez_zalacznika", { plik: nazwaZip(NUMER) });
  $("#wyslane-numer").textContent = NUMER;

  // Ekran po wysłaniu: słowa z wyslane_brak_odnosnik w tekście wyslane_brak to przycisk, który
  // wraca do kroku 6 z wpisanym adresem. Bez tej frazy w tekście zostaje sam tekst.
  const brak = t("wyslane_brak");
  const popraw = t("wyslane_brak_odnosnik");
  const miejscePoprawy = brak.indexOf(popraw);
  if (miejscePoprawy < 0) {
    $("#wyslane-brak").textContent = brak;
  } else {
    const przycisk = el("button", { type: "button", klasa: "przycisk-tekstowy w-tekscie", id: "wyslane-popraw", tekst: popraw });
    przycisk.addEventListener("click", wrocDoWysylki);
    $("#wyslane-brak").replaceChildren(brak.slice(0, miejscePoprawy), przycisk, brak.slice(miejscePoprawy + popraw.length));
  }

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
function zdanieZNumerem(klucz = "numer") {
  const [przed, po] = TEKSTY[klucz].split("{numer}");
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

// Miesiąc faktury: gdy wczytane pliki mają pełne miesiące, jedna lista z pustą pozycją (bez
// wyboru z góry), tymi miesiącami od najnowszego i pozycją „inny miesiąc”. Ta pozycja pokazuje pod
// listą dwie listy (miesiąc i rok) i wtedy wartość pochodzi z nich. Bez pełnego miesiąca w plikach
// listy nie ma, a wartość dają same dwie listy.
const INNY_MIESIAC = "inny";
let miesiaceZPliku = []; // pozycje listy z pliku ({ rok, miesiac, wartosc }), bez pustej i „inny”
const wybranoInny = () => $("#p-okres-lista").value === INNY_MIESIAC;

// „październik 2025”: miesiąc słownie i rok, jak w tabeli miesięcy podglądu.
function miesiacSlownie(rok, miesiac) {
  return `${TEKSTY.miesiace_mianownik[miesiac - 1]} ${rok}`;
}

// Wartość RRRR-MM miesiąca faktury z listy z pliku albo, przy „inny miesiąc” i bez listy, z dwóch
// list (z `niepelny` jak w wartoscMiesiaca).
function wartoscMiesiacaFaktury({ niepelny = false } = {}) {
  if (miesiaceZPliku.length > 0 && !wybranoInny()) return $("#p-okres-lista").value;
  return wartoscMiesiaca($('[data-miesiac="okres_miesiac"]'), { niepelny });
}

// Miesiąc i rok z wartości RRRR-MM w dwóch listach; pusta wartość czyści obie.
function ustawDwieListy(kontener, wartosc) {
  const [r, m] = wartosc ? wartosc.split("-") : ["", ""];
  $('[data-czesc="miesiac"]', kontener).value = m;
  $('[data-czesc="rok"]', kontener).value = r;
}

// Lista miesięcy z pliku po każdej zmianie listy plików. Lata jak w dwóch listach, więc każdy
// miesiąc z listy da się w nich ustawić. Wybór zostaje:
// - miesiąc z listy, który jest na nowej liście, zostaje wybrany;
// - miesiąc z listy, którego na nowej liście nie ma (albo listy już nie ma), przechodzi do dwóch
//   list z tą samą wartością, a na liście (jeśli jest) wybrana jest pozycja „inny miesiąc”;
// - „inny miesiąc” zostaje, także gdy jego miesiąc jest teraz na liście (bez przenoszenia po cichu);
// - lista pojawia się po wyborze w dwóch listach (także niepełnym): wybór zostaje jako „inny miesiąc”;
// - lista znika przy pustej pozycji: dwie listy też są puste, bo schowane w nich wartości nie
//   obowiązywały, a klient nie wybrał miesiąca.
function zbudujListeMiesiecy() {
  const lista = $("#p-okres-lista");
  const dwie = $('[data-miesiac="okres_miesiac"]');
  const byla = miesiaceZPliku.length > 0;
  const poprzedni = byla ? lista.value : "";
  const zListy = poprzedni !== INNY_MIESIAC ? poprzedni : "";
  const rokBiezacy = liczbaZCyfr(dzisiaj().slice(0, 4));
  miesiaceZPliku = miesiaceFaktury(przygotowane.analiza, { odRoku: ROK_FAKTURY_OD, doRoku: rokBiezacy });
  const jest = miesiaceZPliku.length > 0;
  const naLiscie = miesiaceZPliku.some((m) => m.wartosc === zListy);
  if (zListy && !naLiscie) ustawDwieListy(dwie, zListy);
  if (byla && !jest && poprzedni === "") ustawDwieListy(dwie, "");
  lista.replaceChildren(
    el("option", { value: "", tekst: t("faktura_miesiac_wybierz") }),
    ...miesiaceZPliku.map((m) => el("option", { value: m.wartosc, tekst: miesiacSlownie(m.rok, m.miesiac) })),
    el("option", { value: INNY_MIESIAC, tekst: t("faktura_miesiac_inny") }),
  );
  if (!jest) lista.value = "";
  else if (!byla) lista.value = wartoscMiesiaca(dwie, { niepelny: true }) ? INNY_MIESIAC : "";
  else if (naLiscie) lista.value = zListy;
  else lista.value = poprzedni === "" ? "" : INNY_MIESIAC;
}

const STREFY = { g11: 1, g12: 2, g12w: 2, g13: 3 };
let strefInnej = 1;
const wartosciCen = { jedna: "", strefy: [] };

// Nazwy stref z taryfy TAURON Dystrybucja: G12 dzienna i nocna, G12w szczytowa i pozaszczytowa.
function nazwyStref(taryfa) {
  if (taryfa === "g12") return TEKSTY.strefy_g12;
  if (taryfa === "g12w") return TEKSTY.strefy_g12w;
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
// faktura podaje jedną średnią cenę. G12, G12w i G13 mają od razu pola stref (jedną cenę klient
// wpisuje w każde pole, mówi o tym podpowiedź pod polami). Przy taryfie „inna” liczby stref nie
// znamy, więc klient wybiera jedną cenę albo osobne ceny.
function wyborStref() {
  const taryfa = wybrane("taryfa");
  const stala = wybrane("rodzaj_ceny") !== "dynamiczna";
  const znane = stala && (STREFY[taryfa] ?? 0) > 1;
  const wyborTrybu = stala && taryfa === "inna";
  return { taryfa, znane, wyborTrybu, strefy: znane || (wyborTrybu && wybrane("cena_tryb") === "strefy") };
}

function zbudujPolaCen() {
  zapamietajCeny();
  const { taryfa, znane, wyborTrybu, strefy } = wyborStref();
  pokaz($("#cena-tryb"), wyborTrybu);
  pokaz($("#cena-strefy-jedna"), znane);
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
  // G12, G12w i G13 mają nazwane pola, więc kolejność wynika z nazw; przy taryfie „inna” pola mają
  // tylko numery i trzeba je wypełnić w kolejności z faktury.
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

// Zmiany w okresie objętym plikami: pole wyboru, a po zaznaczeniu miesiąc i rok. Przy rozbudowie
// instalacji fotowoltaicznej nad miesiącem jest podpis, a pod nim nieobowiązkowe pole mocy przed
// rozbudową z podpowiedzią i własnym komunikatem błędu.
function zbudujZmiany() {
  $("#zmiany").replaceChildren(...Object.entries(TEKSTY.opcje_zmiany).map(([rodzaj, etykieta], i) => {
    const id = `p-zmiana-${i}`;
    const szczegoly = [listyMiesiacaIRoku(`zmiany-${i}`)];
    if (rodzaj === "rozbudowa_pv") {
      szczegoly.unshift(el("p", { klasa: "podpis", tekst: t("instalacja_rozbudowa_od") }));
      szczegoly.push(el("div", { klasa: "pole", "data-pole": "moc_przed_kwp" },
        el("label", { for: "p-moc_przed_kwp", tekst: t("instalacja_moc_przed") }),
        el("input", { type: "text", id: "p-moc_przed_kwp", inputmode: "decimal", autocomplete: "off", "aria-describedby": "moc-przed-pomoc" }),
        el("p", { klasa: "podpowiedz", id: "moc-przed-pomoc", tekst: t("instalacja_moc_przed_pomoc") }),
        el("p", { klasa: "blad", hidden: true })));
    }
    return el("div", { klasa: "zmiana", "data-zmiana": String(i), "data-rodzaj": rodzaj },
      el("label", { klasa: "opcja" }, el("input", { type: "checkbox", id }), el("span", { tekst: etykieta })),
      el("div", { klasa: "zmiana-szczegoly", hidden: true }, ...szczegoly),
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
  // Lista miesięcy z pliku i jej podpowiedź tylko przy pełnych miesiącach w plikach; dwie listy
  // bez nich albo po wyborze „inny miesiąc”.
  const zPliku = miesiaceZPliku.length > 0;
  pokaz($("#p-okres-lista"), zPliku);
  pokaz($("#faktura-miesiac-pomoc"), zPliku);
  pokaz($('[data-miesiac="okres_miesiac"]'), !zPliku || wybranoInny());
  for (const z of $$("[data-zmiana]")) pokaz($(".zmiana-szczegoly", z), $('input[type="checkbox"]', z).checked);
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
    okres_miesiac: innyOkres ? "" : wartoscMiesiacaFaktury({ niepelny: true }),
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
    // Moc przed rozbudową tylko z wiersza rozbudowy instalacji fotowoltaicznej.
    zmiany: $$("[data-zmiana]").map((z) => ({
      rodzaj: $('input[type="checkbox"]', z).checked ? z.dataset.rodzaj : "",
      miesiac: wartoscMiesiaca($(".miesiac-rok", z)),
      ...(z.dataset.rodzaj === "rozbudowa_pv" && { moc_przed_kwp: wartoscPola("moc_przed_kwp") }),
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
  zbudujListeMiesiecy();
}

function ustawBlokadeOdczytu() {
  $("#wybor-plikow").disabled = czytanie;
  for (const b of $$("#lista-plikow button")) b.disabled = czytanie;
  $("#kreator-dalej").disabled = czytanie && aktualnyKrok === 1;
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

  // Pod listą plików tylko blokady z plików; blokada z pól formularza stoi w kroku 6, przy zapisie
  // i wysyłce, a „Dalej” zatrzymuje się na nią w kroku z polem, które ją wywołało (bladKroku).
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
// Wiersz zmiany ma własny komunikat bezpośrednio w sobie; komunikat pola mocy przed rozbudową
// leży głębiej i należy do tego pola.
function kontenerBledu(pole) {
  const m = /^(oplaty_stale_inne|zmiany)\[(\d+)\]/.exec(pole);
  if (m) {
    const wiersz = m[1] === "zmiany" ? $(`[data-zmiana="${m[2]}"]`) : $(`[data-oplata="${m[2]}"]`);
    return wiersz ? $(":scope > .blad", wiersz) : null;
  }
  const nazwa = pole.replace(/\[.*$/, "");
  const kontener = $(`[data-pole="${nazwa}"]`);
  return kontener ? $(":scope > .blad", kontener) : null;
}

function pokazPola() {
  // Komunikaty plików, kreatora i kroku 6 mają własną obsługę.
  for (const b of $$(".blad", $("main"))) {
    if (b.closest("#lista-plikow, #blokady, .kreator-komunikat, #krok-wysylka")) continue;
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
  // Ceny w strefach w odwrotnej kolejności: tylko uwaga, z nazwami strefy zwykle najdroższej
  // i najtańszej w tej taryfie.
  const kolejnosc = wynik.uwagi.some((u) => u.kod === "FAKTURA_CENY_KOLEJNOSC") && STREFY_KOLEJNOSC[wybrane("taryfa")];
  const kolejnoscEl = $("#faktura-ceny-kolejnosc");
  if (kolejnosc) {
    const nazwy = nazwyStref(wybrane("taryfa"));
    kolejnoscEl.textContent = t("faktura_ceny_kolejnosc", { najdrozsza: nazwy[kolejnosc.najdrozsza], najtansza: nazwy[kolejnosc.najtansza] });
  } else kolejnoscEl.textContent = "";
  pokaz(kolejnoscEl, Boolean(kolejnosc));
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

// Nazwa pola do komunikatów (pola_nazwy).
function nazwyPol(bledy) {
  const pola = [...new Set(bledy.map((b) => b.pole.replace(/\[.*$/, "")))];
  return [...new Set(pola.map((p) => TEKSTY.pola_nazwy[p] ?? p))];
}

// --- Kreator ---------------------------------------------------------------------------------

const sekcjaKroku = (n) => $(`section[data-krok="${n}"]`);
const komunikatKroku = (n) => $(".kreator-komunikat", sekcjaKroku(n));

// Widoczny jest jeden krok. Po przejściu strona przewija się na górę, a nagłówek kroku dostaje
// fokus (bez fokusu tylko przy otwarciu strony). Wejście na krok 6 zawsze otwiera widok wysyłki,
// nigdy ekranu po wysłaniu (ten ma własny fokus, pokazWyslane). Wejście na krok 5 przygotowuje ZIP.
function pokazKrok(n, { fokus = true } = {}) {
  aktualnyKrok = n;
  for (const s of $$("section.krok")) pokaz(s, s.dataset.krok === String(n));
  for (const k of $$(".kreator-komunikat")) pokaz(k, false);
  if (n === KROKI) widok6 = "wysylka";
  $("#kreator-krok").textContent = t("kreator_krok", { n, m: KROKI });
  $$("#pasek span").forEach((odcinek, i) => odcinek.classList.toggle("zrobiony", i < n));
  pokaz($("#kreator-wstecz"), n > 1 && widok6 !== "wyslane");
  pokaz($("#kreator-dalej"), n < KROKI);
  ustawBlokadeOdczytu();
  if (n >= 5) zbudujZip();
  pokazRozmiar();
  pokazWysylke();
  if (fokus) {
    window.scrollTo(0, 0);
    $("h1", sekcjaKroku(n)).focus({ preventScroll: true });
  }
}

// Pole formularza, w którym jest błąd: element z komunikatem błędu leży bezpośrednio w nim.
function kontenerPola(pole) {
  const b = kontenerBledu(pole);
  return b ? b.parentElement : null;
}

// Pozycje listy `lista` ({ pole, … }, nazwy pól jak w błędach pól), których pole leży w kroku `n`,
// z kontenerem pola, w kolejności na stronie. Pole bez kontenera na stronie pomija.
function wKroku(n, lista) {
  const sekcja = sekcjaKroku(n);
  return wKolejnosci(lista
    .map((b) => ({ ...b, kontener: kontenerPola(b.pole) }))
    .filter((b) => b.kontener && sekcja.contains(b.kontener)));
}

function wKolejnosci(lista) {
  return [...lista].sort((a, b) => (a.kontener === b.kontener ? 0 : a.kontener.compareDocumentPosition(b.kontener) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

const widoczne = (e) => !e.disabled && e.getClientRects().length > 0;

// Element, który dostaje fokus przy błędzie: konkretne pole ceny w strefie albo część opłaty, gdy
// moduł je wskazuje, w pozostałych przypadkach pierwsze widoczne pole w kontenerze. Pole
// w zwiniętej części (opłaty stałe) najpierw ją rozwija. Błąd całego pola ceny (format jednej
// ceny, liczba stref) wskazuje pierwsze puste pole ceny, a gdy pustego nie ma, pierwsze pole
// ceny: przełącznik jednej ceny i cen w strefach przy taryfie „inna” stoi w tym samym polu
// przed polami cen i nie jest błędny.
function poleDoFokusu({ pole, kontener }) {
  const zwiniete = kontener.closest("details");
  if (zwiniete && !zwiniete.open) zwiniete.open = true;
  if (pole === "cena_energii_netto_zl_kwh") {
    const ceny = $$("#cena-pola input").filter(widoczne);
    const cena = ceny.find((e) => !e.value.trim()) ?? ceny[0];
    if (cena) return cena;
  }
  // Miesiąc faktury przy „inny miesiąc”: błąd dotyczy dwóch list (miesiąc bieżący albo tylko jedna
  // część), a lista z pliku stoi w polu przed nimi i nie jest błędna.
  if (pole === "okres_miesiac" && miesiaceZPliku.length > 0 && wybranoInny()) return $('[data-miesiac="okres_miesiac"] [data-czesc="miesiac"]');
  const strefa = /^cena_energii_netto_zl_kwh\[(\d+)\]$/.exec(pole);
  const czesc = /\.(nazwa|kwota_zl_mies)$/.exec(pole);
  const wskazane = strefa ? $(`#p-cena-${strefa[1]}`) : czesc ? $(`[data-czesc="${czesc[1] === "nazwa" ? "nazwa" : "kwota"}"]`, kontener) : null;
  if (wskazane) return wskazane;
  return $$("input, select", kontener).find(widoczne) ?? kontener;
}

// Tekst blokady z plików taki sam jak pod listą plików.
function tekstBlokady(b) {
  return tekstKodu(b.kod, { ...(b.wiersz !== undefined && { wiersz: b.wiersz }), ...(b.znacznik && { data: znacznikPolski(b.znacznik) }) });
}

// Co zatrzymuje „Dalej” w kroku `n`: null albo { tekst, fokus }.
// - krok 1: co najmniej jeden przyjęty plik i brak blokad plików;
// - kroki 2–4: błąd w polu tego kroku (format, miesiąc bieżący, niepełny miesiąc, za duża moc przed
//   rozbudową) albo pole tego kroku, które wywołało blokadę bezpiecznika plików JSON (tekst
//   blokady). Pole blokady, którego nie ma w żadnym kroku, nie zatrzymuje: blokada stoi wtedy
//   w kroku 6. Brak danych obowiązkowych z faktury nie zatrzymuje (pokazuje go uwaga pod ostatnim
//   polem kroku 3);
// - krok 5: bez warunków, zgoda jest nieobowiązkowa.
function bladKroku(n) {
  if (n === 1) {
    const komunikat = komunikatKroku(1);
    if (!wynik) return { tekst: t("blad_nieznany"), fokus: komunikat };
    const blokady = wynik.blokady.filter((b) => b.kod !== BLOKADA_POL);
    if (blokady.length > 0) return { tekst: [...new Set(blokady.map(tekstBlokady))].join(" "), fokus: komunikat };
    if (!wynik.pliki.some((p) => p.stan === "przyjety" || p.stan === "uwaga")) return { tekst: t("kreator_pliki_brak"), fokus: komunikat };
    return null;
  }
  if (n >= 2 && n <= 4) {
    const bledne = wKroku(n, wynik?.bledyPol ?? []);
    const blokada = wKroku(n, (wynik?.polaBezpiecznika ?? []).map((pole) => ({ pole })));
    if (bledne.length === 0 && blokada.length === 0) return null;
    const teksty = [];
    if (bledne.length > 0) teksty.push(t("kreator_popraw", { pola: nazwyPol(bledne).join(", ") }));
    if (blokada.length > 0) teksty.push(t(BLOKADA_POL));
    return { tekst: teksty.join(" "), fokus: poleDoFokusu(wKolejnosci([...bledne, ...blokada])[0]) };
  }
  return null;
}

function dalej() {
  if (czekaPrzeliczenie) przelicz();
  const blad = bladKroku(aktualnyKrok);
  if (blad) {
    const komunikat = komunikatKroku(aktualnyKrok);
    komunikat.textContent = blad.tekst;
    pokaz(komunikat, true);
    blad.fokus.focus();
    return;
  }
  pokazKrok(aktualnyKrok + 1);
}

// „Wstecz” niczego nie sprawdza i niczego nie kasuje.
function wstecz() {
  pokazKrok(aktualnyKrok - 1);
}

// Komunikat kreatora po zmianie danych: znika, gdy przyczyna zniknęła, inaczej ma aktualną treść.
function odswiezKomunikatKroku() {
  const komunikat = komunikatKroku(aktualnyKrok);
  if (!komunikat || komunikat.hidden) return;
  const blad = bladKroku(aktualnyKrok);
  if (blad) komunikat.textContent = blad.tekst;
  else pokaz(komunikat, false);
}

// Pytanie przeglądarki przed opuszczeniem strony: gdy są wczytane pliki, a zgłoszenie z aktualnymi
// danymi nie zostało wysłane ani zapisane.
function ostrzezPrzedWyjsciem(z) {
  z.preventDefault();
  // Starsze przeglądarki pytają tylko przy ustawionym returnValue.
  z.returnValue = true;
}

let ostrzezenieUstawione = false;
function ustawOstrzezenie() {
  const potrzebne = pliki.length > 0 && !oddane;
  if (potrzebne === ostrzezenieUstawione) return;
  ostrzezenieUstawione = potrzebne;
  if (potrzebne) window.addEventListener("beforeunload", ostrzezPrzedWyjsciem);
  else window.removeEventListener("beforeunload", ostrzezPrzedWyjsciem);
}

// --- ZIP -------------------------------------------------------------------------------------

// Zmiana danych: przygotowany ZIP już im nie odpowiada, a zapisany albo wysłany plik też nie.
function uniewaznijZip() {
  zip = null;
  budowanyDla = null;
  bladZipu = null;
  oddane = false;
  bladWysylki = null;
  ustawOstrzezenie();
}

// Kompresja jest asynchroniczna. Gotowy ZIP trafia do pamięci tylko wtedy, gdy dane się w tym
// czasie nie zmieniły (to samo zgłoszenie i żadna zmiana nie czeka na przeliczenie). Nieudana
// kompresja daje ZIP metodą 0 (zip.js); gdy i to się nie uda, obietnica jest odrzucona: krok 6
// pokazuje zip_blad, a następne wywołanie (wejście na krok 5 albo 6) próbuje od nowa.
function zbudujZip() {
  if (!wynik?.moznaZapisac || zip?.wynik === wynik || budowanyDla === wynik) return;
  const budowany = wynik;
  budowanyDla = budowany;
  bladZipu = null;
  utworzZipZgloszenia(budowany).then((bajty) => {
    if (wynik !== budowany || czekaPrzeliczenie) return;
    zip = { wynik: budowany, bajty };
    budowanyDla = null;
    pokazRozmiar();
    pokazWysylke();
  }, (blad) => {
    // Błąd zostaje w konsoli przeglądarki (lokalnie, nic nie jest wysyłane).
    console.error(blad);
    if (budowanyDla !== budowany) return;
    budowanyDla = null;
    if (wynik !== budowany || czekaPrzeliczenie) return;
    bladZipu = budowany;
    pokazWysylke();
  });
}

function aktualnyZip() {
  return zip && zip.wynik === wynik && !czekaPrzeliczenie ? zip : null;
}

// Rozmiar zgłoszenia pod podglądem, gdy ZIP jest gotowy.
function pokazRozmiar() {
  const gotowy = aktualnyZip();
  const e = $("#podglad-rozmiar");
  e.textContent = gotowy ? t("podglad_rozmiar", { rozmiar: rozmiarDoWyswietlenia(gotowy.bajty.length) }) : "";
  pokaz(e, Boolean(gotowy));
}

// --- Krok 6: wysyłka, droga zapasowa, ekran po wysłaniu ----------------------------------------

function pokazWysylke() {
  const gotowy = aktualnyZip();
  const zaDuzy = Boolean(gotowy) && zipZaDuzy(gotowy.bajty.length);

  // Powód, dla którego nie ma ZIP-a do zapisu i wysyłki.
  const powod = $("#zapis-powod");
  let tresc = "";
  if (!wynik) tresc = t("zapis_blokada");
  else if (wynik.powod === "brak_plikow") tresc = t("zapis_brak_plikow");
  // Przy blokadzie z pól komunikat o polach stoi tutaj, także gdy pliki mają własną blokadę (ta
  // jest wtedy opisana pod listą plików).
  else if (wynik.powod === "blokada" && wynik.blokady.some((b) => b.kod === BLOKADA_POL)) tresc = t(BLOKADA_POL);
  else if (wynik.powod === "blokada") tresc = t("zapis_blokada");
  else if (wynik.powod === "bledy_pol") tresc = t("zapis_popraw", { pola: nazwyPol(wynik.bledyPol).join(", ") });
  else if (bladZipu === wynik) tresc = t("zip_blad");
  powod.textContent = tresc;
  pokaz(powod, Boolean(tresc) && widok6 !== "wyslane");

  pokaz($("#wysylka-tytul"), widok6 !== "wyslane");
  pokaz($("#widok-wysylka"), widok6 === "wysylka");
  pokaz($("#widok-zapasowa"), widok6 === "zapasowa" || (widok6 === "wysylka" && !WYSYLKA_DOSTEPNA));
  pokaz($("#widok-wyslane"), widok6 === "wyslane");
  // Bez wysyłki przez stronę: zamiast pola adresu i przycisku tekst wysylka_niedostepna, a pod nim
  // od razu droga zapasowa (bez powrotu do wysyłki).
  pokaz($("#wysylka-formularz"), WYSYLKA_DOSTEPNA);
  pokaz($("#wysylka-niedostepna"), !WYSYLKA_DOSTEPNA);
  pokaz($("#zapasowa-pokaz"), WYSYLKA_DOSTEPNA);
  pokaz($("#zapasowa-wroc"), WYSYLKA_DOSTEPNA);
  // Po wysłaniu bez przycisków kreatora: ekran ma własny przycisk.
  pokaz($("#kreator-przyciski"), !(aktualnyKrok === KROKI && widok6 === "wyslane"));

  const przycisk = $("#wyslij");
  przycisk.textContent = t(wysylkaTrwa ? "wysylka_trwa" : "wysylka_przycisk");
  przycisk.disabled = !gotowy || zaDuzy || wysylkaTrwa;
  // Za duży ZIP: przycisk nieaktywny, tekst o zapisie pliku, droga zapasowa pod spodem.
  const klucz = zaDuzy ? "wysylka_za_duzy" : bladWysylki;
  const komunikat = $("#wysylka-komunikat");
  komunikat.textContent = klucz ? t(klucz) : "";
  pokaz(komunikat, Boolean(klucz));
  $("#zapisz").disabled = !gotowy;
  // W trakcie wysyłki dane zgłoszenia zostają takie, jakie wysłano.
  $("#kreator-wstecz").disabled = wysylkaTrwa;
}

// Komunikat po nieudanej wysyłce znika, gdy klient zmienia adres albo znów wybiera przycisk
// wysyłki: nie stoi obok tekstu o błędnym adresie i nie opisuje próby, która jeszcze się nie
// odbyła.
function schowajBladWysylki() {
  if (!bladWysylki) return;
  bladWysylki = null;
  pokazWysylke();
}

// Linia pod przyciskiem wysyłki: po 5 s bez odpowiedzi liczba sekund do końca limitu czasu,
// odświeżana co sekundę. null chowa linię.
function pokazCzekanie(sekundy) {
  const e = $("#wysylka-czekanie");
  e.textContent = sekundy === null ? "" : t("wysylka_czekanie", { sekundy });
  pokaz(e, sekundy !== null);
}

function pokazBladAdresu(widoczny) {
  pokaz($("#adres-blad"), widoczny);
  if (widoczny) $("#p-adres").setAttribute("aria-invalid", "true");
  else $("#p-adres").removeAttribute("aria-invalid");
}

function pokazZapasowa() {
  widok6 = "zapasowa";
  pokazWysylke();
  $("#zapasowa-tytul").focus();
}

function wrocZZapasowej() {
  widok6 = "wysylka";
  pokazWysylke();
  $("#wysylka-tytul").focus();
}

// Z ekranu po wysłaniu z powrotem do kroku 6 z wpisanym adresem: ponowna wysyłka tego samego
// zgłoszenia z poprawionym adresem (obowiązuje ostatnie).
function wrocDoWysylki() {
  widok6 = "wysylka";
  $("#kreator-krok").textContent = t("kreator_krok", { n: KROKI, m: KROKI });
  pokaz($("#kreator-wstecz"), true);
  pokazWysylke();
  $("#p-adres").focus();
}

function pokazWyslane() {
  widok6 = "wyslane";
  const klucz = wyslanePotwierdzenie ? "wyslane_potwierdzenie" : "wyslane_bez_potwierdzenia";
  const [przed, po] = TEKSTY[klucz].split("{adres}");
  $("#wyslane-potwierdzenie").replaceChildren(przed, el("strong", { klasa: "adres", tekst: wyslanyAdres }), po);
  // Nad paskiem postępu zamiast numeru kroku napis „Gotowe”.
  $("#kreator-krok").textContent = t("kreator_gotowe");
  pokaz($("#kreator-wstecz"), false);
  pokazWysylke();
  window.scrollTo(0, 0);
  $("#wyslane-tytul").focus({ preventScroll: true });
}

// Wysyłka: najpierw sprawdzenie, czy wysyłka przez stronę jest tu dostępna (ukrycie pola
// i przycisku nie jest jedynym zabezpieczeniem), potem zniknięcie komunikatu poprzedniej próby,
// potem adres sprawdzony przed żądaniem (zły adres: tekst przy polu, bez żądania), potem jedno
// żądanie z gotowym ZIP-em, z limitem czasu i odliczaniem pod przyciskiem. Przed żądaniem nie ma
// czekania na kompresję. Odpowiedź zamienia na tekst moduł wysylka.js.
async function wyslij() {
  if (!wysylkaDostepna(location.protocol, location.hostname)) return;
  schowajBladWysylki();
  if (czekaPrzeliczenie) przelicz();
  const gotowy = aktualnyZip();
  const adres = sprawdzAdres($("#p-adres").value);
  if (!adres.ok) {
    pokazBladAdresu(true);
    $("#p-adres").focus();
    return;
  }
  if (!gotowy || zipZaDuzy(gotowy.bajty.length) || wysylkaTrwa) return;
  pokazBladAdresu(false);
  wysylkaTrwa = true;
  bladWysylki = null;
  pokazWysylke();
  const kontroler = new AbortController();
  const limit = setTimeout(() => kontroler.abort(), CZAS_WYSYLKI_MS);
  const poczatek = performance.now();
  const odliczanie = setInterval(() => pokazCzekanie(sekundyCzekania(performance.now() - poczatek)), 1000);
  let odpowiedz = null;
  try {
    const o = await fetch("/zgloszenie/", {
      method: "POST",
      body: gotowy.bajty,
      headers: { "Content-Type": "application/zip", "X-Numer": NUMER, "X-Adres": adres.adres },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: kontroler.signal,
    });
    odpowiedz = { status: o.status, json: await o.json().catch(() => null) };
  } catch {
    // Brak odpowiedzi: błąd sieci, przekroczony czas albo przekierowanie.
    odpowiedz = null;
  } finally {
    clearTimeout(limit);
    clearInterval(odliczanie);
    pokazCzekanie(null);
  }
  wysylkaTrwa = false;
  const w = wynikWysylki(odpowiedz);
  if (w.wyslane) {
    wyslanyAdres = adres.adres;
    wyslanePotwierdzenie = w.potwierdzenie;
    oddane = true;
    ustawOstrzezenie();
    pokazWyslane();
  } else if (w.przyPolu) {
    pokazBladAdresu(true);
    pokazWysylke();
    $("#p-adres").focus();
  } else {
    bladWysylki = w.klucz;
    pokazWysylke();
  }
}

// --- Droga zapasowa: zapis i wiadomość -------------------------------------------------------

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

// Każde przeliczenie unieważnia ZIP i potwierdzenie zapisu. Na krokach 5 i 6 ZIP powstaje od razu
// od nowa.
function przelicz() {
  clearTimeout(odlozone);
  czekaPrzeliczenie = false;
  warunki();
  schowajPotwierdzenieZapisu();
  uniewaznijZip();
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
  } catch (blad) {
    // Błąd zostaje w konsoli przeglądarki (lokalnie, nic nie jest wysyłane), żeby dało się go
    // znaleźć; komunikaty modułów nie zawierają danych z plików.
    console.error(blad);
    pokazBladLogiki();
  }
  ustawBlokadeOdczytu();
  odswiezKomunikatKroku();
  if (aktualnyKrok >= 5) zbudujZip();
  pokazRozmiar();
  pokazWysylke();
}

// Wyjątek z logiki nie unieruchamia strony: zapis i wysyłka są zablokowane z ogólnym komunikatem,
// a każda kolejna zmiana pola albo listy plików liczy wszystko od nowa.
function pokazBladLogiki() {
  wynik = null;
  $("#blokady").replaceChildren(komunikat("blad", t("blad_nieznany")));
  schowajPotwierdzenieZapisu();
}

// Zmiana pola przelicza zgłoszenie po 250 ms, ale ZIP i potwierdzenie zapisu tracą ważność od
// razu: nie odpowiadają już danym na stronie. Adres e-mail nie należy do zgłoszenia.
function przeliczPozniej(z) {
  if (z?.target?.id === "p-adres") return;
  clearTimeout(odlozone);
  czekaPrzeliczenie = true;
  uniewaznijZip();
  pokazRozmiar();
  pokazWysylke();
  schowajPotwierdzenieZapisu();
  odlozone = setTimeout(przelicz, 250);
}

// „Inny okres” po wybranym miesiącu: puste pola dat dostają pierwszy i ostatni dzień tego
// miesiąca. Wpisanych dat nie zmienia; bez pełnego wyboru miesiąca i roku nic nie robi.
function wpiszDatyZMiesiaca() {
  const od = $("#p-okres_od");
  const doDnia = $("#p-okres_do");
  const okres = okresMiesiaca(wartoscMiesiacaFaktury());
  if (!okres || od.value || doDnia.value) return;
  od.value = okres.od;
  doDnia.value = okres.do;
}

// Liczba wpisana od przecinka („,3”) po wyjściu z pola dostaje zero na początku („0,3”); klient
// widzi poprawioną wartość. Moduły dalej przyjmują tylko pełny zapis.
function uzupelnijZero(pole) {
  const z = zeroPrzedPrzecinkiem(pole.value);
  if (z !== pole.value) pole.value = z;
}

// Cena po wyjściu z pola: poprawna wartość w postaci z co najmniej dwoma miejscami i przecinkiem
// („1” -> „1,00”); błędna zostaje tak, jak ją wpisano, przy niej stoi komunikat.
function uzupelnijCene(pole) {
  const c = czytajCene(pole.value);
  if (c.ok) pole.value = c.wartosc.replace(".", ",");
}

// Zmiana pola (zdarzenie change, u pól tekstowych po wyjściu z pola): reakcje zależne od pola,
// potem przeliczenie od razu. Wybór plików i adres e-mail mają własną obsługę.
function zmianaPola(z) {
  const pole = z.target;
  if (pole.id === "wybor-plikow" || pole.id === "p-adres") return;
  // Pstryk sprzedaje dziś tylko w cenie dynamicznej. Klient może ją zmienić, a zmiana sprzedawcy
  // niczego nie kasuje.
  if (pole.name === "sprzedawca" && pole.value === "pstryk") $('input[name="rodzaj_ceny"][value="dynamiczna"]').checked = true;
  if (pole.id === "p-okres-inny" && pole.checked) wpiszDatyZMiesiaca();
  if (pole.matches('input[inputmode="decimal"]')) uzupelnijZero(pole);
  if (pole.matches("#p-cena, [data-strefa]")) uzupelnijCene(pole);
  if (["taryfa", "cena_tryb", "rodzaj_ceny", "sprzedawca"].includes(pole.name)) zbudujPolaCen();
  przelicz();
}

// Zapis z gotowego ZIP-a, bez czekania na kompresję. Zmiana czekająca na przeliczenie unieważnia
// ZIP, więc wtedy nic nie jest zapisywane.
function zapisz() {
  if (czekaPrzeliczenie) przelicz();
  const gotowy = aktualnyZip();
  if (!gotowy) return;
  // Pytanie przed opuszczeniem strony zdjęte przed kliknięciem odnośnika z plikiem: przeglądarka
  // może potraktować pobranie jak opuszczenie strony.
  oddane = true;
  ustawOstrzezenie();
  const adres = URL.createObjectURL(new Blob([gotowy.bajty], { type: "application/zip" }));
  const a = el("a", { href: adres, download: gotowy.wynik.nazwaZip });
  document.body.append(a);
  a.click();
  a.remove();
  // Adres pliku musi chwilę żyć, zwłaszcza w Safari na iOS.
  setTimeout(() => URL.revokeObjectURL(adres), 60000);

  if (poprzedniZapis && !rowneBajty(poprzedniZapis, gotowy.bajty)) zapisanoRozne = true;
  poprzedniZapis = gotowy.bajty;
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
  $("#kreator-dalej").addEventListener("click", dalej);
  $("#kreator-wstecz").addEventListener("click", wstecz);
  $("#zapisz").addEventListener("click", zapisz);
  $("#wyslij").addEventListener("click", wyslij);
  $("#zapasowa-pokaz").addEventListener("click", pokazZapasowa);
  $("#zapasowa-wroc").addEventListener("click", wrocZZapasowej);
  // Adres e-mail: poprawianie chowa komunikat przy polu i komunikat po nieudanej wysyłce. Wysyłkę
  // zaczyna tylko przycisk; Enter w polu niczego nie wysyła (pole nie leży w formularzu HTML).
  $("#p-adres").addEventListener("input", () => {
    pokazBladAdresu(false);
    schowajBladWysylki();
  });
  przelicz();
  pokazKrok(1, { fokus: false });
}

start();
