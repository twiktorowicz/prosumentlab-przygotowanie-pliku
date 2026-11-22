#!/usr/bin/env node
// Próba narzędzia w prawdziwej przeglądarce (Chrome albo Chromium bez okna), sterowanej przez
// protokół DevTools, bez bibliotek. Pliki wejściowe powstają z generatora danych syntetycznych.
// Nie wchodzi do `node --test` ani do CI: wymaga zainstalowanej przeglądarki.
//
// Użycie:
//   node narzedzia/proba-przegladarki.mjs --chrome "/ścieżka/do/chrome" [--zostaw] [--blad-probny]
//   CHROME="/ścieżka/do/chrome" node narzedzia/proba-przegladarki.mjs
// macOS: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
//
// Sprawdza przepływ z dokumentacji (pliki, zakres, formularz, podgląd, zapis ZIP-a z kompresją,
// odnośnik mailto, blokady) na szerokości 1280 px i 390 px oraz to, że karta ze stroną nie wysyła żadnego
// zapytania poza własne pliki, nie pisze w konsoli błędów i nie zostawia niczego w przeglądarce.
// Krok wysyłki w dwóch wariantach: zwykły ekran z kursorem (droga z zapisem) i telefon z emulacją
// ekranu dotykowego, pointer: coarse (droga z udostępnianiem na atrapach, odmowa przełącza na zapis).
// Zmiany z wersji 0.1.4 (kolejność pytań, ceny, Pstryk, „inny okres”, sprzedawca z listy, różne PPE,
// zmiana pola tuż przed zapisem) sprawdza osobna część w obu wariantach. Tak samo zmiany z wersji
// 0.1.5 (napis ProsumentLab w nagłówku, akapit o operatorze, pola stref bez wyboru przy G12, G12w
// i G13, nazwy stref G12w, granica nietypowej ceny 2,00 zł/kWh, nowe pomoce do ceny).
//
// Wszystko, co skrypt tworzy, leży w jednym katalogu tymczasowym (pliki wejściowe, profil
// przeglądarki, pobrany ZIP, zrzuty). Katalog jest usuwany, a przeglądarka i serwer zamykane
// zawsze: po próbie, po wyjątku, po przekroczeniu czasu i po Ctrl+C. Z opcją --zostaw katalog
// zostaje do obejrzenia. Opcja --blad-probny rzuca wyjątek w trakcie próby, żeby sprawdzić
// sprzątanie.
//
// Kod wyjścia: 0 wszystko w porządku, 1 co najmniej jedno sprawdzenie nie przeszło, 2 złe wywołanie,
// 3 próba przerwana wyjątkiem.

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { utworzSerwer } from "./serwer.mjs";
import { generuj, PPE_FIKCYJNE, PLATNICY_FIKCYJNI } from "./generator.mjs";
import { czytajZip } from "../test/pomoc/czytnik-zip.mjs";

const { values } = parseArgs({
  options: { chrome: { type: "string" }, zostaw: { type: "boolean", default: false }, "blad-probny": { type: "boolean", default: false } },
});
const CHROME = values.chrome ?? process.env.CHROME;
if (!CHROME) {
  process.stderr.write("proba-przegladarki: podaj ścieżkę przeglądarki (--chrome albo zmienna CHROME)\n");
  process.exit(2);
}

const CZAS_STARTU_MS = 20000;
const CZAS_POLECENIA_MS = 30000;

// Stan do sprzątania. Każdy element może nie istnieć, jeśli próba przerwała się wcześniej.
let PRACA = null;
let serwer = null;
let chrome = null;
let ws = null;

// Zamyka przeglądarkę i czeka na jej wyjście, bo pisze do profilu jeszcze chwilę po sygnale.
// Nie czeka na zdarzenie, które już minęło; po 5 s dobija ją SIGKILL, po 10 s przestaje czekać.
function zakonczChrome(p) {
  if (!p || p.pid === undefined || p.exitCode !== null || p.signalCode !== null) return Promise.resolve();
  return new Promise((ok) => {
    const dobij = setTimeout(() => p.kill("SIGKILL"), 5000);
    const poddaj = setTimeout(ok, 10000);
    p.once("exit", () => {
      clearTimeout(dobij);
      clearTimeout(poddaj);
      ok();
    });
    p.kill();
  });
}

let posprzatane = false;
async function sprzataj() {
  if (posprzatane) return;
  posprzatane = true;
  try {
    ws?.close();
  } catch {
    // połączenie już zamknięte
  }
  await zakonczChrome(chrome);
  if (serwer) {
    serwer.closeAllConnections?.();
    await new Promise((ok) => serwer.close(() => ok()));
  }
  if (!PRACA) return;
  if (values.zostaw) process.stdout.write(`Zrzuty i pliki: ${PRACA}\n`);
  else rmSync(PRACA, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

for (const sygnal of ["SIGINT", "SIGTERM"]) {
  process.once(sygnal, () => {
    process.stderr.write(`proba-przegladarki: przerwana (${sygnal}), sprzątam\n`);
    sprzataj().finally(() => process.exit(130));
  });
}

const wyniki = [];
const sprawdz = (opis, warunek, szczegoly = "") => wyniki.push(`${warunek ? "OK  " : "BŁĄD"} ${opis}${szczegoly ? ` (${szczegoly})` : ""}`);

async function proba() {
  PRACA = mkdtempSync(join(tmpdir(), "proba-przegladarki-"));
  for (const k of ["pliki", "pobrane", "zrzuty"]) mkdirSync(join(PRACA, k));
  const plik = (nazwa, bajty) => {
    const p = join(PRACA, "pliki", nazwa);
    writeFileSync(p, bajty);
    return p;
  };
  const plikRok = plik("eLicznik_2025.csv", generuj({ od: "2025-01-01", do: "2025-12-31", ziarno: 5 }).surowy);
  const plikStyczen = plik("eLicznik_styczen.csv", generuj({ od: "2026-01-01", do: "2026-01-31", ziarno: 5 }).surowy);
  const plikZly = plik("zepsuty.csv", generuj({ od: "2025-02-01", do: "2025-02-02", ziarno: 5, ppeWStrefie: { znacznik: "2025-02-01 05:00", seria: "pobor" } }).surowy);
  const plikArkusz = plik("arkusz.xlsx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]));
  const plikiRoczne = [2022, 2023, 2024, 2025].map((r) => plik(`rok_${r}.csv`, generuj({ od: `${r}-01-01`, do: `${r}-12-31`, ziarno: 3 }).surowy));
  // Dwanaście plików jednodniowych (limit 10 pozycji), kopia pliku pod inną nazwą (duplikat),
  // plik bez kolumn z numerami i plik z samą nieistniejącą godziną 03:00 z doby zmiany czasu.
  const plikiDni = Array.from({ length: 12 }, (_, i) => {
    const dzien = `2025-03-${String(i + 1).padStart(2, "0")}`;
    return plik(`dzien_${i + 1}.csv`, generuj({ od: dzien, do: dzien, ziarno: 5 }).surowy);
  });
  const plikKopia = plik("kopia_stycznia.csv", readFileSync(plikStyczen));
  const plikInnyPunkt = plik("inny_punkt.csv", generuj({ od: "2026-02-01", do: "2026-02-28", ziarno: 5, ppe: PPE_FIKCYJNE[1] }).surowy);
  const plikBezNumerow = plik("bez_numerow.csv", generuj({ od: "2026-02-01", do: "2026-02-28", ziarno: 5 }).bezNumerow);
  // Ten sam styczeń (to samo ziarno, te same wartości), ale drugi fikcyjny PPE i płatnik.
  const plikStyczenInnyPpe = plik("styczen_inny_ppe.csv", generuj({ od: "2026-01-01", do: "2026-01-31", ziarno: 5, ppe: PPE_FIKCYJNE[1], platnik: PLATNICY_FIKCYJNI[1] }).surowy);
  const plikMarzec = plik("marzec_0300.csv", generuj({
    od: "2025-03-30", do: "2025-03-30", ziarno: 5, obetnijKoniec: 22,
    podmien: ["oddanie", "pobor"].map((seria) => ({ znacznik: "2025-03-30 01:00", seria, pole: "znacznik", tekst: "2025-03-30 03:00" })),
  }).surowy);

  serwer = utworzSerwer();
  await new Promise((ok) => serwer.listen(0, "127.0.0.1", ok));
  const ADRES = `http://127.0.0.1:${serwer.address().port}/`;

  // Jedyne adresy, jakie przeglądarka dostaje od skryptu, to about:blank i ADRES. Flagi wyłączają
  // jej własny ruch w tle (aktualizacje składników, synchronizację, pingi) i dostęp do pęku kluczy
  // systemu, żeby nic nie wychodziło poza katalog tymczasowy i poza 127.0.0.1.
  chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-pings",
    "--use-mock-keychain", "--password-store=basic",
    `--user-data-dir=${join(PRACA, "profil")}`, "--remote-debugging-port=0", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((ok, blad) => {
    let bufor = "";
    const limit = setTimeout(() => blad(new Error(`przeglądarka nie wystartowała w ${CZAS_STARTU_MS / 1000} s`)), CZAS_STARTU_MS);
    chrome.stderr.on("data", (d) => {
      bufor += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(bufor);
      if (m) {
        clearTimeout(limit);
        ok(m[1]);
      }
    });
    chrome.once("error", (e) => {
      clearTimeout(limit);
      blad(e);
    });
    chrome.once("exit", (kod, sygnal) => {
      clearTimeout(limit);
      blad(new Error(`przeglądarka zakończyła się przed startem (kod ${kod}, sygnał ${sygnal})`));
    });
  });

  ws = new WebSocket(wsUrl);
  await new Promise((ok, blad) => {
    ws.addEventListener("open", ok);
    ws.addEventListener("error", () => blad(new Error("brak połączenia z przeglądarką")));
  });
  let nr = 0;
  const oczekujace = new Map();
  const zdarzenia = [];
  ws.addEventListener("message", (m) => {
    const w = JSON.parse(m.data);
    if (w.id && oczekujace.has(w.id)) {
      const { ok, blad } = oczekujace.get(w.id);
      oczekujace.delete(w.id);
      if (w.error) blad(new Error(JSON.stringify(w.error)));
      else ok(w.result);
    } else if (w.method) zdarzenia.push(w);
  });
  ws.addEventListener("close", () => {
    for (const { blad } of oczekujace.values()) blad(new Error("połączenie z przeglądarką zamknięte"));
    oczekujace.clear();
  });
  const cdp = (method, params = {}, sessionId) => new Promise((ok, blad) => {
    const id = ++nr;
    const limit = setTimeout(() => {
      oczekujace.delete(id);
      blad(new Error(`${method}: brak odpowiedzi w ${CZAS_POLECENIA_MS / 1000} s`));
    }, CZAS_POLECENIA_MS);
    oczekujace.set(id, {
      ok: (w) => { clearTimeout(limit); ok(w); },
      blad: (e) => { clearTimeout(limit); blad(e); },
    });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
  });
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  const strona = (m, p) => cdp(m, p, sessionId);
  for (const d of ["Page", "Runtime", "Log", "Network", "DOM"]) await strona(`${d}.enable`);
  await cdp("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: join(PRACA, "pobrane"), eventsEnabled: true });

  const czekaj = (ms) => new Promise((ok) => setTimeout(ok, ms));
  async function js(wyrazenie) {
    const w = await strona("Runtime.evaluate", { expression: wyrazenie, awaitPromise: true, returnByValue: true });
    if (w.exceptionDetails) throw new Error(`JS: ${w.exceptionDetails.exception?.description ?? w.exceptionDetails.text}`);
    return w.result.value;
  }
  async function szerokosc(px) {
    await strona("Emulation.setDeviceMetricsOverride", { width: px, height: 900, deviceScaleFactor: 1, mobile: px < 600 });
    await czekaj(300);
  }
  async function zrzut(nazwa, px) {
    await szerokosc(px);
    const { cssContentSize } = await strona("Page.getLayoutMetrics");
    const { data } = await strona("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: px, height: Math.ceil(cssContentSize.height), scale: 1 } });
    writeFileSync(join(PRACA, "zrzuty", `${nazwa}.png`), Buffer.from(data, "base64"));
  }
  async function ustawPliki(sciezki, ms = 1500) {
    const { root } = await strona("DOM.getDocument");
    const { nodeId } = await strona("DOM.querySelector", { nodeId: root.nodeId, selector: "#wybor-plikow" });
    await strona("DOM.setFileInputFiles", { nodeId, files: sciezki });
    await czekaj(ms);
  }
  async function otworz() {
    await strona("Page.navigate", { url: ADRES });
    await czekaj(1500);
  }
  const wpisz = (wybor, wartosc, zdarzenie = "change") =>
    js(`(() => { const e = document.querySelector(${JSON.stringify(wybor)}); e.value = ${JSON.stringify(wartosc)}; e.dispatchEvent(new Event(${JSON.stringify(zdarzenie)}, { bubbles: true })); })()`);
  const tekstEl = (wybor) => js(`document.querySelector(${JSON.stringify(wybor)})?.textContent ?? ""`);
  const klik = async (wybor) => {
    await js(`document.querySelector(${JSON.stringify(wybor)}).click()`);
    await czekaj(300);
  };
  const widoczny = (wybor) => js(`(() => { const e = document.querySelector(${JSON.stringify(wybor)}); return Boolean(e) && !e.hidden && e.getClientRects().length > 0; })()`);

  // 1. Pusta strona.
  await szerokosc(1280);
  await otworz();
  if (values["blad-probny"]) throw new Error("błąd próbny (--blad-probny)");
  sprawdz("tytuł strony", (await js("document.title")) === "Narzędzie do przygotowania pliku");
  sprawdz("teksty wstawione do wszystkich elementów", (await js("[...document.querySelectorAll('[data-tekst]')].filter(e => !e.textContent.trim()).length")) === 0);
  sprawdz("numer zgłoszenia w zdaniu", /^Numer Twojego zgłoszenia to [0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}\./.test(await tekstEl("#numer")));
  const czcionki = await js(`(() => { const p = document.querySelector('#numer'); const s = p.querySelector('.numer-zgloszenia');
    return { zdanie: getComputedStyle(p).fontFamily, numer: s && getComputedStyle(s).fontFamily, dzieci: p.querySelectorAll('*').length }; })()`);
  sprawdz("czcionką o stałej szerokości tylko numer", czcionki.dzieci === 1 && /Mono/.test(czcionki.numer) && !/Mono/.test(czcionki.zdanie), JSON.stringify(czcionki));
  sprawdz("zapis zablokowany bez plików", await js("document.querySelector('#zapisz').disabled"));
  const stale = await js(`(() => {
    const widac = (e) => Boolean(e) && !e.hidden && e.getClientRects().length > 0;
    const zapisz = document.querySelector('#zapisz');
    const gotowe = zapisz.nextElementSibling, ponownie = gotowe?.nextElementSibling, gdzie = ponownie?.nextElementSibling;
    const m = document.querySelector('#mailto');
    const zgoda = document.querySelector('.zgoda').nextElementSibling;
    return {
      tytul: document.querySelector('#krok-zapis h2').textContent,
      drogi: widac(document.querySelector('#droga-zapis')) && !widac(document.querySelector('#droga-udostepnianie')) && !widac(document.querySelector('#udostepnij-niedostepne')),
      kroki: [...document.querySelectorAll('#droga-zapis h3')].map(h => widac(h) && h.textContent),
      krok1: zapisz.previousElementSibling?.tagName === 'H3' && gotowe?.id === 'zapis-gotowe' && gotowe.hidden &&
        ponownie?.id === 'zapis-ponownie' && ponownie.hidden && gdzie?.dataset.tekst === 'zapis_gdzie' && widac(gdzie),
      wiadomosc: { href: m.hasAttribute('href'), aria: m.getAttribute('aria-disabled'), opis: m.getAttribute('aria-describedby'), napis: m.textContent,
        najpierw: widac(document.querySelector('#mailto-najpierw-zapisz')) && document.querySelector('#mailto-najpierw-zapisz').textContent,
        bezZalacznika: m.previousElementSibling?.id === 'mailto-bez-zalacznika' && m.previousElementSibling.textContent,
        poZapisie: document.querySelector('#po-zapisie').hidden, kursor: getComputedStyle(m).cursor },
      zgoda: zgoda?.dataset.tekst === 'zgoda_bez' && widac(zgoda) && zgoda.textContent,
    };
  })()`);
  const numerStart = (await tekstEl("#numer")).match(/[0-9A-Z]{4}-[0-9A-Z]{4}/)[0];
  sprawdz("krok 7 „Wysyłka pliku”: na zwykłym ekranie tylko droga z zapisem, krok 1 i krok 2 z nagłówkami",
    stale.tytul === "Wysyłka pliku" && stale.drogi && JSON.stringify(stale.kroki) === JSON.stringify(["Krok 1. Zapisz plik na tym urządzeniu.", "Krok 2. Napisz wiadomość i dołącz zapisany plik."]), JSON.stringify(stale));
  sprawdz("krok 1: zapis_gdzie stale pod przyciskiem zapisu, potwierdzenie zapisu schowane", stale.krok1);
  sprawdz("krok 2 przed zapisem: „Napisz nową wiadomość” bez href, aria-disabled, opis mailto_najpierw_zapisz; nad nim mailto_bez_zalacznika",
    !stale.wiadomosc.href && stale.wiadomosc.aria === "true" && stale.wiadomosc.opis === "mailto-najpierw-zapisz" && stale.wiadomosc.napis === "Napisz nową wiadomość" &&
    stale.wiadomosc.najpierw === "Najpierw zapisz plik w kroku 1." && stale.wiadomosc.kursor === "not-allowed" && stale.wiadomosc.poZapisie &&
    stale.wiadomosc.bezZalacznika === `Wiadomość otworzy się bez załącznika. Zanim ją wyślesz, dołącz plik prosumentlab_${numerStart}.zip z folderu Pobrane.`, JSON.stringify(stale.wiadomosc));
  sprawdz("zgoda_bez w nowym brzmieniu stale pod polem zgody",
    stale.zgoda === "Darmowy raport przygotujemy także bez tej zgody: pomagasz nam samym plikiem i danymi z faktury, z którymi porównamy obliczenia. Bez zgody plik i liczby z faktury usuniemy najpóźniej 3 dni po wysłaniu raportu.", stale.zgoda);
  sprawdz("teksty 0.1.2: tytuł kroku 6 i zapis_gdzie", (await tekstEl("#krok-podglad h2")) === "Zawartość pliku ZIP" &&
    (await tekstEl('[data-tekst="zapis_gdzie"]')).startsWith("Plik zapisze się na tym urządzeniu: na komputerze zwykle w folderze Pobrane, na iPhonie w aplikacji Pliki"));
  sprawdz("powód: brak plików", (await tekstEl("#zapis-powod")) === "Najpierw wybierz plik godzinowy.");
  sprawdz("bez uwagi o brakujących polach na pustej stronie", await js("document.querySelector('#faktura-brak').hidden"));
  const odnosniki = await js("[...document.querySelectorAll('#plik-instrukcja a, #zgoda-wiecej a, #wersja a')].map(a => [a.getAttribute('href'), a.target, a.rel])");
  sprawdz("odnośniki instrukcji, zgody i repozytorium w nowej karcie", odnosniki.length === 3 && odnosniki.every(([, t, r]) => t === "_blank" && r === "noopener noreferrer"), JSON.stringify(odnosniki));
  sprawdz("krok 1: „jak go pobrać z eLicznika” prowadzi do /jak-pobrac-dane-z-elicznika/", await js(`(() => { const p = document.querySelector('#plik-instrukcja'); const a = p.querySelector('a');
    return p.previousElementSibling.dataset.tekst === 'pliki_wybor' && p.textContent === 'Nie masz jeszcze pliku? Zobacz, jak go pobrać z eLicznika.' && a.textContent === 'jak go pobrać z eLicznika' && a.getAttribute('href') === '/jak-pobrac-dane-z-elicznika/'; })()`));
  sprawdz("odnośnik zgody poza etykietą pola", await js("!document.querySelector('#zgoda-etykieta a') && document.querySelector('#zgoda-wiecej a').getAttribute('href') === '/prywatnosc/'"));
  sprawdz("zakres przed dodaniem pliku: zakres_pusty", (await tekstEl("#zakres")) === "Zakres pojawi się tu po dodaniu pliku.");
  const faktura = await js(`(() => ({
    pierwsze: document.querySelector('#krok-faktura [data-pole]').dataset.pole,
    wstep: document.querySelector('#krok-faktura h2 + p').textContent,
    zwiniete: [...document.querySelectorAll('#krok-faktura details')].every(d => !d.open),
    pomoc: document.querySelectorAll('details.pomoc').length,
    numery: [...document.querySelectorAll('.nr')].every(n => n.getAttribute('aria-hidden') === 'true'),
    operator: document.querySelectorAll('[name="operator_dystrybucyjny"], [name="pierwsze_oddanie"], [name="rodzaj_faktury"]').length,
    sprzedawcy: [...document.querySelectorAll('[name="sprzedawca"]')].map(e => e.value).join(","),
  }))()`);
  sprawdz("faktura: wstęp, system rozliczenia jako pierwsze pole", faktura.pierwsze === "system_rozliczenia" && faktura.wstep.startsWith("Przepisz dane z najnowszej faktury"), JSON.stringify(faktura));
  sprawdz("faktura: „Co to znaczy?” i opłaty stałe zwinięte", faktura.zwiniete && faktura.pomoc === 5);
  sprawdz("faktura: numery pól ukryte przed czytnikiem ekranu", faktura.numery);
  sprawdz("bez pytań o operatora, rodzaj faktury i pierwsze oddanie", faktura.operator === 0);
  sprawdz("sprzedawca Pstryk przed „inny”", faktura.sprzedawcy.endsWith("pstryk,inny"), faktura.sprzedawcy);
  await js("document.querySelector('details.pomoc summary').click()");
  sprawdz("„Co to znaczy?” rozwija się kliknięciem", (await js("document.querySelector('details.pomoc').open")) && (await js("document.querySelector('details.pomoc p').getBoundingClientRect().height")) > 0);
  await js("document.querySelector('details.pomoc summary').click()");
  const listy = await js("[...document.querySelectorAll('[data-miesiac=\"magazyn_od\"] select')].map(s => s.options[0].textContent)");
  sprawdz("puste pozycje list: „miesiąc” i „rok”", JSON.stringify(listy) === JSON.stringify(["miesiąc", "rok"]), JSON.stringify(listy));
  // Rok bieżący z zegara przeglądarki (tego samego, którego używa strona).
  const [rokTeraz, miesiacTeraz] = await js("(() => { const d = new Date(); return [String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0')]; })()");
  const okres = await js(`(() => {
    const widac = (e) => Boolean(e) && !e.hidden && e.getClientRects().length > 0;
    const [m, r] = document.querySelectorAll('[data-miesiac="okres_miesiac"] select');
    return {
      legenda: document.querySelector('[data-pole="okres_miesiac"] legend').textContent,
      widoczny: widac(m) && widac(r), daty: widac(document.querySelector('#okres-daty')),
      puste: m.value === '' && r.value === '',
      miesiace: [...m.options].map(o => o.textContent), lata: [...r.options].map(o => o.value),
      pole: document.querySelector('#p-okres-inny').checked, etykieta: document.querySelector('#p-okres-inny').nextElementSibling.textContent,
    };
  })()`);
  const lataOczekiwane = [""];
  for (let r = Number(rokTeraz); r >= 2022; r--) lataOczekiwane.push(String(r));
  sprawdz("faktura: domyślnie miesiąc z dwóch pustych list, bez pól dat", okres.legenda === "2Miesiąc, za który jest faktura" && okres.widoczny && !okres.daty && okres.puste && !okres.pole &&
    okres.etykieta === "Faktura obejmuje inny okres niż jeden miesiąc", JSON.stringify(okres));
  sprawdz("faktura: nazwy miesięcy jak przy magazynie, lata od bieżącego wstecz do 2022",
    okres.miesiace.length === 13 && okres.miesiace[0] === "miesiąc" && okres.miesiace[1] === "styczeń" && okres.miesiace[12] === "grudzień" &&
    JSON.stringify(okres.lata) === JSON.stringify(lataOczekiwane), JSON.stringify(okres.lata));

  // 2. Rysunek faktury: dwie strony, obok siebie na szerokim ekranie, jedna pod drugą na telefonie.
  await czekaj(300);
  const rysunek = async () => js(`(() => { const [a, b] = document.querySelectorAll('.rysunek-strony img'); const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return { zaladowane: a.naturalWidth > 0 && b.naturalWidth > 0, obok: Math.abs(ra.top - rb.top) < 1 && rb.left > ra.right, podSoba: rb.top >= ra.bottom, szerokosc: ra.width,
      opis: document.querySelector('#rysunek-faktury').getAttribute('aria-label') }; })()`);
  const r1280 = await rysunek();
  sprawdz("rysunek: obie strony załadowane", r1280.zaladowane);
  sprawdz("rysunek: opis dla czytnika ekranu", r1280.opis?.startsWith("Schemat dwóch stron faktury"));
  sprawdz("rysunek 1280 px: strony obok siebie", r1280.obok, `szerokość strony ${r1280.szerokosc.toFixed(0)} px`);
  await szerokosc(390);
  const r390 = await rysunek();
  // Kółko z numerem ma w rysunku promień 9 przy szerokości 262: liczymy jego średnicę na ekranie.
  const srednica = (18 * r390.szerokosc) / 262;
  sprawdz("rysunek 390 px: strony jedna pod drugą", r390.podSoba);
  sprawdz("rysunek 390 px: kółko z numerem co najmniej 20 px", srednica >= 20, `${srednica.toFixed(1)} px`);
  sprawdz("telefon 390 px: bez poziomego przewijania", (await js("document.documentElement.scrollWidth")) <= 390, String(await js("document.documentElement.scrollWidth")));
  await zrzut("1-start-telefon", 390);
  await zrzut("1-start-komputer", 1280);

  // 3. Pliki.
  await ustawPliki([plikRok, plikStyczen, plikArkusz]);
  const plakietki = await js("[...document.querySelectorAll('.plakietka')].map(e => e.textContent)");
  sprawdz("plakietki plików", JSON.stringify(plakietki) === JSON.stringify(["Przyjęty", "Przyjęty", "Odrzucony"]), plakietki.join(", "));
  sprawdz("komunikat przy pliku arkusza", (await js("document.querySelectorAll('.plik')[2].textContent")).includes("plik arkusza kalkulacyjnego"));
  const zakres = await tekstEl("#zakres");
  sprawdz("zakres: 13 miesięcy, jedna kropka po „r.”", zakres.includes("Dane obejmują 13 pełnych miesięcy z rzędu, od stycznia 2025 r. do stycznia 2026 r. To wystarczy do pełnego raportu.") && !zakres.includes(".."), zakres.slice(0, 110));
  sprawdz("po przyjęciu pliku uwaga o brakujących polach", !(await js("document.querySelector('#faktura-brak').hidden")) && (await tekstEl("#faktura-brak")).startsWith("Bez tych danych nie przygotujemy raportu: sposób wyceny energii oddanej, sprzedawca,"), await tekstEl("#faktura-brak"));
  const podgladPlikow = await js(`(() => {
    const pod = document.querySelector('#podglad');
    const csv = pod.querySelector('details[data-plik="pomiary_1.csv"]');
    return {
      akapity: [...pod.children].filter(e => e.tagName === 'P').map(p => p.textContent),
      lista: [...pod.querySelectorAll('.lista-zip > li > details.plik-zip > summary')].map(s => s.textContent),
      details: pod.querySelectorAll('details').length,
      otwarte: pod.querySelectorAll('details[open]').length,
      widoczne: [...pod.querySelectorAll('pre, table')].filter(e => e.checkVisibility()).length,
      tabele: [...pod.querySelectorAll('table')].map(t => t.closest('details')?.dataset.plik ?? ''),
      miesiace: pod.querySelector('details.miesiace > summary')?.textContent,
      dane: [...csv.querySelectorAll('dt')].map(d => d.textContent),
      wiersze: csv.querySelector('pre').textContent.split('\\n').length,
      numer: pod.querySelectorAll('.numer, .numer-zgloszenia').length,
      starych: pod.querySelectorAll('h3, .z-pliku').length,
    };
  })()`);
  sprawdz("podgląd: wstęp i stan zgody na górze", JSON.stringify(podgladPlikow.akapity) === JSON.stringify(["Tak wygląda plik, który zapiszesz na swoim urządzeniu i wyślesz sam. Wybierz nazwę pliku, żeby zobaczyć, co jest w środku.", "Zgoda niezaznaczona"]), JSON.stringify(podgladPlikow.akapity));
  sprawdz("podgląd: lista plików w kolejności z ZIP-a, z opisami i nazwą pliku źródłowego",
    JSON.stringify(podgladPlikow.lista) === JSON.stringify([
      "zgloszenie.jsonopis zgłoszenia: wersja narzędzia, numer, zakres danych i uwagi",
      "pomiary_1.csvdane godzinowe z pliku eLicznik_2025.csv, bez numeru punktu poboru i numeru płatnika",
      "pomiary_2.csvdane godzinowe z pliku eLicznik_styczen.csv, bez numeru punktu poboru i numeru płatnika",
    ]), JSON.stringify(podgladPlikow.lista));
  sprawdz("podgląd: po przeliczeniu żaden <details> nie jest otwarty, treść niewidoczna",
    podgladPlikow.details === 4 && podgladPlikow.otwarte === 0 && podgladPlikow.widoczne === 0, JSON.stringify(podgladPlikow));
  sprawdz("podgląd: tabela miesięcy tylko w osobnym <details>, bez tabeli plików i listy na końcu",
    JSON.stringify(podgladPlikow.tabele) === JSON.stringify(["miesiace"]) && podgladPlikow.miesiace === "Energia pobrana i oddana w każdym miesiącu" && podgladPlikow.starych === 0);
  sprawdz("podgląd: pomiary_N.csv z wierszami, godzinami, usuniętymi kolumnami i pierwszymi wierszami",
    JSON.stringify(podgladPlikow.dane) === JSON.stringify(["Wiersze", "Pierwsza godzina", "Ostatnia godzina", "Usunięte kolumny"]) && podgladPlikow.wiersze === 6, JSON.stringify(podgladPlikow));
  sprawdz("podgląd: bez zdania z numerem zgłoszenia", podgladPlikow.numer === 0);

  // 4. Formularz.
  await js(`(() => {
    const klik = (s) => document.querySelector(s).click();
    const wpisz = (s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); };
    klik('input[name="sprzedawca"][value="tauron_sprzedaz"]');
    klik('input[name="taryfa"][value="g13"]');
    const okres = document.querySelector('[data-miesiac="okres_miesiac"]');
    okres.querySelector('[data-czesc="miesiac"]').value = '01'; okres.querySelector('[data-czesc="rok"]').value = '2026';
    okres.querySelector('select').dispatchEvent(new Event("change", { bubbles: true }));
    klik('input[name="system_rozliczenia"][value="net_billing_rce"]');
    klik('input[name="rodzaj_ceny"][value="stala"]');
    wpisz('#p-cena-0', '0,60000'); wpisz('#p-cena-1', '0,70000'); wpisz('#p-cena-2', '0,40000');
    wpisz('#p-oplata_mocowa_zl_mies', '12,34000'); wpisz('#p-oplata_abonamentowa_zl_mies', '5,67'); wpisz('#p-oplata_stala_sieciowa_zl_mies', '8,9');
    wpisz('#p-oplata-0-nazwa', 'Opłata handlowa'); wpisz('#p-oplata-0-kwota', '9,99000');
    wpisz('#p-moc_pv_kwp', '7,2');
    klik('input[name="magazyn"][value="tak"]');
    wpisz('#p-magazyn_pojemnosc_kwh', '10');
    const z = document.querySelector('[data-zmiana="0"]');
    z.querySelector('input[type="checkbox"]').click();
    z.querySelector('[data-czesc="miesiac"]').value = '07'; z.querySelector('[data-czesc="rok"]').value = '2025';
    z.querySelector('select').dispatchEvent(new Event("change", { bubbles: true }));
    klik('#p-zgoda');
  })()`);
  await czekaj(600);
  // Niepełny wybór miesiąca magazynu: komunikat przy polu i blokada zapisu.
  await wpisz('[data-miesiac="magazyn_od"] [data-czesc="miesiac"]', "04");
  await czekaj(300);
  sprawdz("magazyn: sam miesiąc bez roku daje komunikat", (await tekstEl('[data-pole="magazyn_od"] .blad')) === "Wybierz miesiąc i rok albo zostaw oba pola puste.");
  sprawdz("magazyn: niepełny wybór blokuje zapis", await js("document.querySelector('#zapisz').disabled") && (await tekstEl("#zapis-powod")).includes("od kiedy działa magazyn"));
  await wpisz('[data-miesiac="magazyn_od"] [data-czesc="rok"]', "2022");
  await czekaj(300);
  sprawdz("strefy G13 z nazwami z faktury", JSON.stringify(await js("[...document.querySelectorAll('#cena-pola label')].map(e => e.textContent)")) === JSON.stringify(["szczyt przedpołudniowy", "szczyt popołudniowy", "pozostałe godziny doby"]));
  sprawdz("komplet pól: bez uwagi o brakujących polach", await js("document.querySelector('#faktura-brak').hidden"));
  sprawdz("zapis odblokowany", !(await js("document.querySelector('#zapisz').disabled")));
  const fakturyTeraz = () => js("document.querySelector('#podglad details[data-plik=\"faktury.json\"] pre')?.textContent ?? ''");
  const fakturyStyczen = await fakturyTeraz();
  const okresStyczen = fakturyStyczen.includes('"okres_od": "2026-01-01",\n    "okres_do": "2026-01-31",');
  sprawdz("miesiąc styczeń 2026: w faktury.json okres od 2026-01-01 do 2026-01-31", okresStyczen, okresStyczen ? "" : fakturyStyczen);
  // Pojemność magazynu: przy „tak” i pustym polu uwaga pod polem, zapis dalej możliwy.
  const pojemnosc = () => js(`(() => { const u = document.querySelector('#pojemnosc-brak');
    return { widac: !u.hidden && u.getClientRects().length > 0, tekst: u.textContent, klasa: u.className, pod: u.previousElementSibling?.id,
      zapis: !document.querySelector('#zapisz').disabled }; })()`);
  sprawdz("magazyn „tak” z pojemnością: bez uwagi o pojemności", !(await pojemnosc()).widac);
  await wpisz("#p-magazyn_pojemnosc_kwh", "", "input");
  await czekaj(400);
  let poj = await pojemnosc();
  sprawdz("magazyn „tak” bez pojemności: uwaga instalacja_pojemnosc_brak pod polem, zapis możliwy",
    poj.widac && poj.klasa === "uwaga" && poj.pod === "p-magazyn_pojemnosc_kwh" && poj.zapis &&
    poj.tekst === "Jeśli znasz pojemność magazynu, wpisz ją. Bez niej opiszemy wyniki mniej dokładnie.", JSON.stringify(poj));
  await klik('input[name="magazyn"][value="nie"]');
  sprawdz("magazyn „nie”: bez uwagi o pojemności", !(await pojemnosc()).widac);
  await klik('input[name="magazyn"][value="tak"]');
  await wpisz("#p-magazyn_pojemnosc_kwh", "10", "input");
  await czekaj(400);
  poj = await pojemnosc();
  sprawdz("po wpisaniu pojemności uwaga znika", !poj.widac && poj.zapis, JSON.stringify(poj));
  sprawdz("operator wpisany przez narzędzie, rodzaj faktury z pola wyboru", (await tekstEl("#podglad")).includes('"operator_dystrybucyjny": "tauron_dystrybucja"') && (await tekstEl("#podglad")).includes('"rodzaj_faktury": "rozliczeniowa"'));
  const podglad = await tekstEl("#podglad");
  sprawdz("„12,34000” przyjęte i zapisane jako 12.34", podglad.includes('"oplata_mocowa_zl_mies": "12.34"') && podglad.includes('"kwota_zl_mies": "9.99"'));
  sprawdz("podgląd: lista plików w ZIP-ie", ["zgloszenie.json", "faktury.json", "instalacja.json", "pomiary_1.csv", "pomiary_2.csv"].every((n) => podglad.includes(n)));
  await wpisz("#p-oplata_mocowa_zl_mies", "12,341");
  await czekaj(300);
  sprawdz("„12,341” to błąd formatu i blokada zapisu", (await tekstEl('[data-pole="oplata_mocowa_zl_mies"] .blad')).includes("na przykład 12,34") && await js("document.querySelector('#zapisz').disabled"));
  await wpisz("#p-oplata_mocowa_zl_mies", "12,34");
  await czekaj(300);
  await zrzut("2-formularz-telefon", 390);
  await zrzut("2-formularz-komputer", 1280);

  // 5. Wariant 1, zwykły ekran (kursor): droga z zapisem, krok 1 zapis ZIP-a, krok 2 wiadomość.
  const numer = (await tekstEl("#numer")).match(/[0-9A-Z]{4}-[0-9A-Z]{4}/)[0];
  // Zapisy liczone ze zdarzeń przeglądarki: plik o tej samej nazwie przeglądarka sterowana przez
  // DevTools nadpisuje, zamiast dopisać (1), więc liczba plików w katalogu nie rośnie.
  const zapisy = () => zdarzenia.filter((z) => z.method === "Browser.downloadWillBegin").length;
  // Czeka, aż przeglądarka zacznie `n`-ty zapis i plik pojawi się w katalogu (najwyżej 10 s).
  const czekajNaPobrane = async (n) => {
    const plik = () => readdirSync(join(PRACA, "pobrane")).includes(`prosumentlab_${numer}.zip`);
    for (let i = 0; i < 40 && !(zapisy() >= n && plik()); i++) await czekaj(250);
    return zapisy();
  };
  const pobrane = () => readdirSync(join(PRACA, "pobrane")).filter((n) => n.endsWith(".zip"));
  const przelicz = async () => {
    await wpisz("#p-oplata_mocowa_zl_mies", "12,34");
    await czekaj(300);
  };
  // Wiadomość w kroku 2: aktywna (href, bez aria-disabled, bez opisu) dopiero po zapisie.
  const wiadomosc = () => js(`(() => { const m = document.querySelector('#mailto'), n = document.querySelector('#mailto-najpierw-zapisz');
    return { href: m.getAttribute('href'), aria: m.getAttribute('aria-disabled'), opis: m.getAttribute('aria-describedby'),
      najpierw: !n.hidden && n.getClientRects().length > 0, kursor: getComputedStyle(m).cursor }; })()`);
  const drogi = () => js(`(() => { const widac = (s) => { const e = document.querySelector(s); return !e.hidden && e.getClientRects().length > 0; };
    return { zapis: widac('#droga-zapis'), udostepnianie: widac('#droga-udostepnianie'), niedostepne: widac('#udostepnij-niedostepne') }; })()`);
  await js("Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })");
  await przelicz();
  let dr = await drogi();
  let wm = await wiadomosc();
  sprawdz("bez navigator.canShare droga z zapisem, zapis możliwy, wiadomość nieaktywna przed zapisem",
    !(await js("document.querySelector('#zapisz').disabled")) && dr.zapis && !dr.udostepnianie && wm.href === null && wm.aria === "true" && wm.najpierw, JSON.stringify({ dr, wm }));
  await js("document.querySelector('#zapisz').click()");
  await czekajNaPobrane(1);
  const nazwaZip = pobrane().find((n) => n === `prosumentlab_${numer}.zip`) ?? null;
  sprawdz("ZIP zapisany pod nazwą z numerem", Boolean(nazwaZip), nazwaZip ?? "brak");
  if (nazwaZip) {
    const zip = readFileSync(join(PRACA, "pobrane", nazwaZip));
    const zawartosc = czytajZip(zip);
    sprawdz("zawartość ZIP-a", JSON.stringify(zawartosc.map((p) => p.nazwa)) === JSON.stringify(["zgloszenie.json", "faktury.json", "instalacja.json", "pomiary_1.csv", "pomiary_2.csv"]));
    sprawdz("ZIP skompresowany: metoda 8 w każdym pliku, pliki pomiarów wyraźnie mniejsze",
      zawartosc.every((p) => p.metoda === 8) && zawartosc.filter((p) => p.nazwa.endsWith(".csv")).every((p) => p.skompresowany * 3 < p.rozmiar),
      JSON.stringify(zawartosc.map((p) => [p.nazwa, p.metoda, p.skompresowany, p.rozmiar])));
    const z = JSON.parse(new TextDecoder().decode(zawartosc[0].bajty));
    sprawdz("zgloszenie.json: numer, zgoda, klasyfikacja, wersja 0.1.5", z.numer === numer && z.zgoda_przypadek_testowy === true && z.zakres.klasyfikacja === "raport" && z.narzedzie === "0.1.5");
    const tekstZip = zip.toString("latin1");
    sprawdz("w ZIP-ie nie ma numerów PPE ani płatnika ani nazw plików", !tekstZip.includes("590000000000000010") && !tekstZip.includes("10000001") && !tekstZip.includes("eLicznik"));
    const fak = JSON.parse(new TextDecoder().decode(zawartosc[1].bajty));
    sprawdz("faktury.json z miesiąca: okres_od i okres_do, bez okres_miesiac", fak.raport.okres_od === "2026-01-01" && fak.raport.okres_do === "2026-01-31" && !("okres_miesiac" in fak.raport), JSON.stringify(fak.raport));
    const inst = JSON.parse(new TextDecoder().decode(zawartosc[2].bajty));
    sprawdz("instalacja.json z list miesiąca i roku", inst.magazyn_od === "2022-04" && inst.zmiany?.[0]?.miesiac === "2025-07", JSON.stringify(inst));
    // Rozwinięcie pozycji kliknięciem w nazwę; treść ma być równa bajtom pliku w zapisanym ZIP-ie.
    const rozwiniete = await js(`(() => {
      const wynik = {};
      for (const n of ['zgloszenie.json', 'faktury.json']) {
        const d = document.querySelector('#podglad details[data-plik="' + n + '"]');
        if (!d.open) d.querySelector('summary').click();
        const pre = d.querySelector('pre');
        wynik[n] = { open: d.open, widoczny: pre.checkVisibility(), tekst: pre.textContent };
      }
      return wynik;
    })()`);
    for (const [i, n] of [[0, "zgloszenie.json"], [1, "faktury.json"]]) {
      sprawdz(`podgląd: rozwinięty ${n} równy bajtom pliku w ZIP-ie`,
        rozwiniete[n].open && rozwiniete[n].widoczny && rozwiniete[n].tekst === new TextDecoder("utf-8", { fatal: true }).decode(zawartosc[i].bajty));
    }
  }
  sprawdz("komunikat po zapisie widoczny w kroku 2", !(await js("document.querySelector('#po-zapisie').hidden")) && (await js("document.querySelector('#po-zapisie').previousElementSibling.textContent")) === "Krok 2. Napisz wiadomość i dołącz zapisany plik.");
  const mailto = await js("document.querySelector('#mailto').href");
  sprawdz("odnośnik mailto", mailto.startsWith("mailto:raporty@prosumentlab.pl?subject=Dane%20do%20darmowego%20raportu%2C%20zg%C5%82oszenie%20") &&
    mailto.endsWith(`&body=${encodeURIComponent(`Pamiętaj o załączniku: plik prosumentlab_${numer}.zip. Bez niego nie przygotujemy raportu.`)}`));
  wm = await wiadomosc();
  sprawdz("po zapisie „Napisz nową wiadomość” aktywne: href, bez aria-disabled i aria-describedby, bez mailto_najpierw_zapisz",
    wm.href === mailto && wm.aria === null && wm.opis === null && !wm.najpierw && wm.kursor === "pointer", JSON.stringify(wm));
  sprawdz("po zapisie: mailto_bez_zalacznika tuż nad „Napisz nową wiadomość”", await js(`(() => { const u = document.querySelector('#mailto').previousElementSibling;
    return u.id === 'mailto-bez-zalacznika' && u.className === 'uwaga' && u.textContent === 'Wiadomość otworzy się bez załącznika. Zanim ją wyślesz, dołącz plik prosumentlab_${numer}.zip z folderu Pobrane.'; })()`));
  sprawdz("po zapisie: po_zapisie bez zmian", (await tekstEl("#po-zapisie")) === `Plik prosumentlab_${numer}.zip jest zapisany na Twoim urządzeniu. Teraz wyślij go na adres raporty@prosumentlab.pl. Nie załączaj pliku pobranego prosto z eLicznika ani faktury.`);
  const adresWTekscie = await js(`(() => { const a = [...document.querySelectorAll('#po-zapisie a')];
    return a.map(x => ({ tekst: x.textContent, href: x.href, target: x.target, rowny: x.href === document.querySelector('#mailto').href })); })()`);
  sprawdz("po zapisie: adres w po_zapisie to odnośnik z tym samym mailto: co „Napisz nową wiadomość”",
    adresWTekscie.length === 1 && adresWTekscie[0].tekst === "raporty@prosumentlab.pl" && adresWTekscie[0].rowny && adresWTekscie[0].target === "", JSON.stringify(adresWTekscie));
  const ZAPISANO = `Zapisano plik prosumentlab_${numer}.zip.`;
  const potwierdzenie = () => js(`(() => { const g = document.querySelector('#zapis-gotowe'), p = document.querySelector('#zapis-ponownie');
    return { pod: document.querySelector('#zapisz').nextElementSibling === g, gotowe: !g.hidden && g.getClientRects().length > 0 && g.textContent,
      ponownie: !p.hidden && p.getClientRects().length > 0 && p.textContent }; })()`);
  let pz = await potwierdzenie();
  sprawdz("po zapisie: zapis_gotowe tuż pod przyciskiem zapisu, bez zapis_ponownie", pz.pod && pz.gotowe === ZAPISANO && pz.ponownie === false, JSON.stringify(pz));
  dr = await drogi();
  sprawdz("bez navigator.canShare drogi z udostępnianiem nie ma także po zapisie", dr.zapis && !dr.udostepnianie, JSON.stringify(dr));
  await js("document.querySelector('#zapisz').click()");
  const poDrugim = await czekajNaPobrane(2);
  pz = await potwierdzenie();
  sprawdz("drugi zapis tej samej treści: zapis_gotowe bez zapis_ponownie", poDrugim === 2 && pz.gotowe === ZAPISANO && pz.ponownie === false, `${poDrugim} ${JSON.stringify(pz)}`);

  // Przeglądarka umie udostępnić plik (atrapa canShare), ale ekran nie jest dotykowy (kursor):
  // dalej droga z zapisem, bez przycisku udostępniania.
  await js("Object.defineProperty(navigator, 'canShare', { value: (d) => Array.isArray(d?.files) && d.files.length > 0, configurable: true })");
  await przelicz();
  dr = await drogi();
  wm = await wiadomosc();
  sprawdz("canShare przy kursorze (pointer: fine): dalej droga z zapisem", (await js("matchMedia('(pointer: coarse)').matches")) === false && dr.zapis && !dr.udostepnianie, JSON.stringify(dr));
  sprawdz("zmiana pola chowa potwierdzenie zapisu i komunikat po zapisie, wiadomość znów nieaktywna",
    (await js("document.querySelector('#po-zapisie').hidden && document.querySelector('#zapis-gotowe').hidden")) && wm.href === null && wm.aria === "true" && wm.najpierw, JSON.stringify(wm));
  await wpisz("#p-oplata_mocowa_zl_mies", "12,341");
  await czekaj(300);
  sprawdz("przy zablokowanym zapisie powód pod tytułem kroku 7", await js("document.querySelector('#zapisz').disabled") &&
    (await js("(() => { const p = document.querySelector('#zapis-powod'); return !p.hidden && p.previousElementSibling.tagName === 'H2'; })()")));
  await przelicz();

  await wpisz("#p-moc_pv_kwp", "10", "input");
  await czekaj(500);
  const poPrzeliczeniu = await js("[...document.querySelectorAll('#podglad details')].filter(d => d.open).map(d => d.dataset.plik)");
  sprawdz("przeliczenie po zmianie pola nie zwija pozycji rozwiniętych przez klienta", JSON.stringify(poPrzeliczeniu) === JSON.stringify(["zgloszenie.json", "faktury.json"]), JSON.stringify(poPrzeliczeniu));
  await js("document.querySelector('#zapisz').click()");
  const poTrzecim = await czekajNaPobrane(3);
  pz = await potwierdzenie();
  sprawdz("zapis innej treści w tej samej wizycie: zapis_gotowe i zapis_ponownie", poTrzecim === 3 && pz.gotowe === ZAPISANO &&
    pz.ponownie === "To nowsza wersja pliku. Wyślij tylko ją; jeśli przeglądarka dopisała do nazwy (1) albo (2), wybierz plik z najwyższym numerem.", `${poTrzecim} ${JSON.stringify(pz)}`);
  await zrzut("3-po-zapisie-komputer", 1280);
  await zrzut("3-po-zapisie-waski-ekran", 390);
  await szerokosc(1280);

  // 5b. System opustów, cena dynamiczna, korekta, okres: na wypełnionym formularzu.
  // Wybór miesiąca faktury z list; zdarzenie change jak przy wyborze z listy.
  const wybierzMiesiac = (m, r) => js(`(() => { const k = document.querySelector('[data-miesiac="okres_miesiac"]');
    k.querySelector('[data-czesc="miesiac"]').value = ${JSON.stringify(m)}; k.querySelector('[data-czesc="rok"]').value = ${JSON.stringify(r)};
    k.querySelector('select').dispatchEvent(new Event("change", { bubbles: true })); })()`);
  const wartosciMiesiaca = () => js("[...document.querySelectorAll('[data-miesiac=\"okres_miesiac\"] select')].map(s => s.value).join('/')");
  await klik('input[name="system_rozliczenia"][value="opusty"]');
  // Treść faktury.json z podglądu: <pre> tuż po nagłówku z nazwą pliku.
  const fakturyWPodgladzie = () => js("document.querySelector('#podglad details[data-plik=\"faktury.json\"] pre')?.textContent ?? ''");
  let podgladTeraz = await fakturyWPodgladzie();
  sprawdz("opusty: pozostałe pola faktury schowane, tekst o opustach widoczny",
    !(await widoczny("#faktura-pola")) && !(await widoczny('[data-miesiac="okres_miesiac"] select')) && (await tekstEl('[data-pole="system_rozliczenia"] .uwaga')).startsWith("Raportu dla systemu opustów jeszcze nie mamy"));
  sprawdz("opusty: w podglądzie faktury.json tylko operator i system, bez wcześniej wpisanych pól",
    podgladTeraz.includes('"operator_dystrybucyjny": "tauron_dystrybucja",\n    "system_rozliczenia": "opusty"\n  }') &&
    !podgladTeraz.includes('"sprzedawca"') && !podgladTeraz.includes('"oplata_mocowa_zl_mies"') && !podgladTeraz.includes("2026-01-01"), podgladTeraz);
  sprawdz("opusty: bez uwagi o brakujących polach, zapis możliwy", await js("document.querySelector('#faktura-brak').hidden") && !(await js("document.querySelector('#zapisz').disabled")));
  await klik('input[name="system_rozliczenia"][value="net_billing_rce"]');
  podgladTeraz = await fakturyWPodgladzie();
  sprawdz("po powrocie z opustów wpisane wartości wracają na stronę i do podglądu",
    (await widoczny('[data-miesiac="okres_miesiac"] select')) && (await wartosciMiesiaca()) === "01/2026" &&
    podgladTeraz.includes('"okres_od": "2026-01-01"') && podgladTeraz.includes('"sprzedawca": "tauron_sprzedaz"') && podgladTeraz.includes('"oplata_mocowa_zl_mies": "12.34"'));

  await klik('input[name="rodzaj_ceny"][value="dynamiczna"]');
  const dyn = await js(`(() => ({
    tryb: document.querySelector('#cena-tryb').hidden,
    pola: document.querySelectorAll('#cena-pola input').length,
    etykieta: [...document.querySelectorAll('[data-pole="cena_energii_netto_zl_kwh"] legend span:not(.nr)')].filter(s => !s.hidden).map(s => s.textContent).join("|"),
    aria: document.querySelector('#p-cena')?.getAttribute('aria-label'),
  }))()`);
  sprawdz("cena dynamiczna: jedno pole, bez wyboru stref, własna etykieta",
    dyn.tryb && dyn.pola === 1 && dyn.etykieta === "Średnia cena energii z faktury, netto, zł/kWh" && dyn.aria === dyn.etykieta, JSON.stringify(dyn));
  await wpisz("#p-cena", "1,80", "input");
  await czekaj(500);
  sprawdz("cena dynamiczna 1,80: bez uwagi o nietypowej cenie, zapis możliwy",
    !(await widoczny("#faktura-cena-nietypowa")) && !(await js("document.querySelector('#zapisz').disabled")) && (await tekstEl("#podglad")).includes('"cena_energii_netto_zl_kwh": "1.80"'));
  await wpisz("#p-cena", "2,10", "input");
  await czekaj(500);
  sprawdz("cena dynamiczna 2,10: uwaga o nietypowej cenie, zapis możliwy",
    (await widoczny("#faktura-cena-nietypowa")) && !(await js("document.querySelector('#zapisz').disabled")) && (await tekstEl("#podglad")).includes('"cena_energii_netto_zl_kwh": "2.10"'));
  await klik('input[name="rodzaj_ceny"][value="stala"]');
  sprawdz("powrót do ceny stałej: ceny w strefach wracają", JSON.stringify(await js("[...document.querySelectorAll('#cena-pola input')].map(e => e.value)")) === JSON.stringify(["0,60000", "0,70000", "0,40000"]) && !(await widoczny("#faktura-cena-nietypowa")));

  await klik("#p-korekta");
  sprawdz("korekta: pole wyboru, podpowiedź i „korekta” w faktury.json", (await widoczny("#korekta-podpowiedz")) && (await tekstEl("#podglad")).includes('"rodzaj_faktury": "korekta"'));
  await klik("#p-korekta");

  // Miesiąc faktury: bieżący (z zegara przeglądarki) to błąd, niepełny wybór też; luty 2024 ma 29 dni.
  const bladMiesiaca = () => tekstEl('[data-pole="okres_miesiac"] > .blad');
  await wybierzMiesiac(miesiacTeraz, rokTeraz);
  await czekaj(300);
  sprawdz("miesiąc bieżący: błąd faktura_miesiac_biezacy przy liście, blokada zapisu z nazwą „miesiąc faktury”",
    (await bladMiesiaca()) === "Faktury za ten miesiąc jeszcze nie ma. Wybierz miesiąc, który już się skończył." && await js("document.querySelector('#zapisz').disabled") &&
    (await tekstEl("#zapis-powod")) === "Zanim zapiszesz plik ZIP, popraw albo wyczyść te pola: miesiąc faktury.", `${await bladMiesiaca()} | ${await tekstEl("#zapis-powod")}`);
  await wybierzMiesiac("02", "");
  await czekaj(300);
  sprawdz("sam miesiąc bez roku: instalacja_miesiac_niepelny i blokada zapisu",
    (await bladMiesiaca()) === "Wybierz miesiąc i rok albo zostaw oba pola puste." && await js("document.querySelector('#zapisz').disabled"));
  await wybierzMiesiac("02", "2024");
  await czekaj(300);
  sprawdz("luty 2024: okres do 2024-02-29, bez błędu", (await fakturyWPodgladzie()).includes('"okres_od": "2024-02-01",\n    "okres_do": "2024-02-29",') && (await bladMiesiaca()) === "");
  await wybierzMiesiac("01", "2026");
  await czekaj(300);

  // Faktura za inny okres: pole wyboru odsłania dwie daty z wybranego miesiąca, odznaczenie wraca
  // do miesiąca.
  await klik("#p-okres-inny");
  sprawdz("„inny okres” po styczniu 2026: daty 2026-01-01 i 2026-01-31 zamiast list, okres w faktury.json ten sam",
    (await widoczny("#p-okres_od")) && (await widoczny("#p-okres_do")) && !(await widoczny('[data-pole="okres_miesiac"]')) &&
    (await js("document.querySelector('#p-okres_od').value + '/' + document.querySelector('#p-okres_do').value")) === "2026-01-01/2026-01-31" &&
    (await fakturyWPodgladzie()).includes('"okres_od": "2026-01-01",\n    "okres_do": "2026-01-31",'));
  await wpisz("#p-okres_do", "2099-12-31");
  await czekaj(300);
  sprawdz("okres z przyszłości: błąd przy polu i blokada zapisu",
    (await tekstEl('[data-pole="okres_do"] .blad')).startsWith("Koniec okresu jest późniejszy niż dzisiejsza data.") && await js("document.querySelector('#zapisz').disabled"));
  await wpisz("#p-okres_do", "2026-01-31");
  await wpisz("#p-okres_od", "2025-10-01");
  await czekaj(300);
  sprawdz("okres dłuższy niż 62 dni: uwaga, zapis możliwy", (await widoczny("#faktura-okres-dlugi")) && !(await js("document.querySelector('#zapisz').disabled")));
  await klik("#p-okres-inny");
  sprawdz("odznaczenie „inny okres” wraca do wybranego miesiąca, bez uwagi o długim okresie",
    (await widoczny('[data-pole="okres_miesiac"]')) && !(await widoczny("#okres-daty")) && (await wartosciMiesiaca()) === "01/2026" &&
    (await fakturyWPodgladzie()).includes('"okres_od": "2026-01-01",\n    "okres_do": "2026-01-31",') && !(await widoczny("#faktura-okres-dlugi")));
  await klik("#p-okres-inny");
  sprawdz("ponowne zaznaczenie: wpisane daty zostały", (await js("document.querySelector('#p-okres_od').value + '/' + document.querySelector('#p-okres_do').value")) === "2025-10-01/2026-01-31");
  await klik("#p-okres-inny");

  // 6. Blokada bezpiecznika.
  await ustawPliki([plikZly]);
  sprawdz("plik z PPE w kolumnie strefy odrzucony", (await js("document.querySelectorAll('.plik')[3].textContent")).includes("nadal jest coś, co wygląda na numer"));
  sprawdz("blokada zapisu", await js("document.querySelector('#zapisz').disabled") && (await tekstEl("#zapis-powod")).startsWith("Narzędzie nie utworzy pliku ZIP"));
  await js("document.querySelectorAll('.plik')[3].querySelector('button').click()");
  await czekaj(800);
  sprawdz("po usunięciu pliku zapis znów możliwy", !(await js("document.querySelector('#zapisz').disabled")));

  // 6b. Lista plików, duplikat, pliki bez numerów, wyjątek z logiki, podpowiedzi i uwagi pól.
  const plakietkiTeraz = () => js("[...document.querySelectorAll('.plakietka')].map(e => e.textContent)");
  const tekstPliku = (i) => js(`document.querySelectorAll('.plik')[${i}]?.textContent ?? ""`);
  await otworz();
  await ustawPliki(plikiDni, 3000);
  const dwanascie = await plakietkiTeraz();
  sprawdz("12 plików: 10 przyjętych, 11. i 12. odrzucone", dwanascie.length === 12 && dwanascie.slice(0, 10).every((p) => p === "Przyjęty") && dwanascie.slice(10).every((p) => p === "Odrzucony"), dwanascie.join(", "));
  sprawdz("11. plik z komunikatem o limicie 10 plików", (await tekstPliku(10)).includes("najwyżej 10 plików"));
  await js("document.querySelectorAll('.plik')[0].querySelector('button').click()");
  await czekaj(1500);
  const poUsunieciu = await plakietkiTeraz();
  sprawdz("po usunięciu pliku z pierwszej dziesiątki następny jest czytany", poUsunieciu.length === 11 && poUsunieciu.slice(0, 10).every((p) => p === "Przyjęty") && poUsunieciu[10] === "Odrzucony", poUsunieciu.join(", "));

  await otworz();
  await ustawPliki([plikStyczen, plikKopia]);
  sprawdz("ten sam plik drugi raz: blad_duplikat", (await tekstPliku(1)).includes("Taki sam plik jest już na liście") && (await plakietkiTeraz())[0] === "Przyjęty");
  await ustawPliki([plikBezNumerow]);
  sprawdz("dwa pliki, jeden bez numerów: uwaga bez numerów", (await tekstEl("#zakres")).includes("Co najmniej jeden plik nie ma już numeru punktu poboru"));

  await otworz();
  await ustawPliki([plikMarzec]);
  sprawdz("plik z samą godziną 03:00 z doby zmiany czasu przyjęty", (await plakietkiTeraz())[0] === "Przyjęty");
  await js(`(() => { const z = document.querySelector('[data-zmiana="0"]'); z.querySelector('input[type="checkbox"]').click(); })()`);
  await wpisz('[data-zmiana="0"] [data-czesc="miesiac"]', "11");
  await wpisz('[data-zmiana="0"] [data-czesc="rok"]', "2024");
  await czekaj(300);
  sprawdz("po zmianie pola strona dalej działa (zapis możliwy)", !(await js("document.querySelector('#zapisz').disabled")));

  await otworz();
  await ustawPliki([plikStyczen]);
  await js(`(() => { const z = document.querySelector('[data-zmiana="0"]'); z.querySelector('input[type="checkbox"]').click(); })()`);
  await wpisz('[data-zmiana="0"] [data-czesc="miesiac"]', "11");
  await wpisz('[data-zmiana="0"] [data-czesc="rok"]', "2024");
  await czekaj(300);
  const uwagaZmiany = await js(`(() => { const z = document.querySelector('[data-zmiana="0"]'); const u = z.querySelector('.uwaga'), b = z.querySelector('.blad');
    return { uwaga: !u.hidden && u.textContent, blad: !b.hidden, klasa: u.className }; })()`);
  sprawdz("miesiąc zmiany spoza zakresu: styl uwagi, bez błędu, zapis możliwy", typeof uwagaZmiany.uwaga === "string" && uwagaZmiany.uwaga.startsWith("Ten miesiąc nie mieści się") && !uwagaZmiany.blad && !(await js("document.querySelector('#zapisz').disabled")), JSON.stringify(uwagaZmiany));
  await js(`document.querySelector('input[name="taryfa"][value="g12"]').click()`);
  await czekaj(300);
  sprawdz("G12: bez podpowiedzi o kolejności stref", await js("document.querySelector('#strefy-kolejnosc').hidden"));
  await js(`(() => { document.querySelector('input[name="taryfa"][value="inna"]').click(); document.querySelector('input[name="cena_tryb"][value="strefy"]').click(); })()`);
  await czekaj(300);
  sprawdz("taryfa inna, osobna cena w każdej strefie: podpowiedź o kolejności stref", !(await js("document.querySelector('#strefy-kolejnosc').hidden")));
  sprawdz("podpowiedź przy polu nazwy taryfy widoczna", (await js("[...document.querySelectorAll('[data-pole=\"taryfa_nazwa\"] .podpowiedz')].map(p => !p.hidden && p.textContent).join('')")).startsWith("Wpisz tylko nazwę z faktury"));
  await wpisz("#p-taryfa_nazwa", "Taryfa PPE", "input");
  await czekaj(600);
  const POLA = "W polach wpisanych ręcznie jest coś";
  sprawdz("słowo PPE w polu: komunikat przy przycisku zapisu, nie pod listą plików",
    (await tekstEl("#zapis-powod")).startsWith(POLA) && !(await js("document.querySelector('#zapis-powod').hidden")) &&
    !(await tekstEl("#blokady")).includes(POLA) && await js("document.querySelector('#zapisz').disabled"));
  await ustawPliki([plikInnyPunkt]);
  sprawdz("blokada z plików i z pól naraz: pliki w #blokady, pola przy przycisku",
    (await tekstEl("#blokady")).includes("różnych punktów poboru") && !(await tekstEl("#blokady")).includes(POLA) &&
    (await tekstEl("#zapis-powod")).startsWith(POLA));
  await js("document.querySelectorAll('.plik')[1].querySelector('button').click()");
  await czekaj(800);
  await wpisz("#p-taryfa_nazwa", "Taryfa X", "input");
  await czekaj(600);
  sprawdz("po poprawie pola blokada znika", !(await tekstEl("#zapis-powod")).includes(POLA) && !(await js("document.querySelector('#zapisz').disabled")));
  await ustawPliki([plikInnyPunkt]);
  sprawdz("sama blokada z plików: przy przycisku ogólny powód", (await tekstEl("#zapis-powod")) === "Narzędzie nie utworzy pliku ZIP, dopóki nie zniknie problem opisany wyżej.");

  // 6b2. Zmiany z wersji 0.1.4, na świeżo otwartej stronie z plikiem stycznia. Wywoływane w obu
  // wariantach: zwykły ekran z kursorem (tu) i telefon z ekranem dotykowym (w 6c).
  const proba014 = async (wariant, px) => {
    const w = (opis) => `${wariant}: ${opis}`;
    await otworz();
    await ustawPliki([plikStyczen]);
    const kolejnosc = await js(`[...document.querySelectorAll('#krok-faktura h3, #krok-faktura [data-pole]')].map(e => e.tagName === 'H3' ? 'H3 ' + e.textContent : e.dataset.pole)`);
    sprawdz(w("kolejność pytań: „Faktura” (system, sprzedawca, miesiąc, korekta), „Cena energii” (rodzaj ceny, taryfa, cena, opłaty)"), JSON.stringify(kolejnosc) === JSON.stringify([
      "H3 Faktura", "system_rozliczenia", "sprzedawca", "sprzedawca_nazwa", "okres_miesiac", "okres_od", "okres_do", "rodzaj_faktury",
      "H3 Cena energii", "rodzaj_ceny", "taryfa", "taryfa_nazwa", "cena_energii_netto_zl_kwh", "oplata_mocowa_zl_mies", "oplata_abonamentowa_zl_mies",
      "oplata_stala_sieciowa_zl_mies", "oplata_przejsciowa_zl_mies", "oplaty_stale_inne",
    ]), JSON.stringify(kolejnosc));
    const naglowki = async () => [await widoczny('[data-tekst="faktura_grupa_faktura"]'), await widoczny('[data-tekst="faktura_grupa_cena"]')];
    sprawdz(w("oba nagłówki grup widoczne"), JSON.stringify(await naglowki()) === "[true,true]");
    await klik('input[name="system_rozliczenia"][value="opusty"]');
    sprawdz(w("opusty: „Faktura” zostaje, „Cena energii” znika razem z polami"), JSON.stringify(await naglowki()) === "[true,false]");
    await klik('input[name="system_rozliczenia"][value="net_billing_rce"]');

    // Zdanie pod grupą taryfową.
    const zdanieTaryfy = () => js(`[...document.querySelectorAll('[data-pole="taryfa"] .podpowiedz')].filter(p => !p.hidden && p.getClientRects().length > 0).map(p => p.textContent)`);
    const STALA = "Przy cenie stałej strefy grupy taryfowej dotyczą opłat za dystrybucję, a często też ceny energii.";
    const DYNAMICZNA = "Przy cenie dynamicznej grupa taryfowa dotyczy tylko opłat za dystrybucję.";
    sprawdz(w("bez rodzaju ceny bez zdania przy grupie taryfowej"), (await zdanieTaryfy()).length === 0);
    await klik('input[name="rodzaj_ceny"][value="stala"]');
    sprawdz(w("cena stała: zdanie taryfa_przy_stalej"), JSON.stringify(await zdanieTaryfy()) === JSON.stringify([STALA]), JSON.stringify(await zdanieTaryfy()));
    await klik('input[name="rodzaj_ceny"][value="dynamiczna"]');
    sprawdz(w("cena dynamiczna: zdanie taryfa_przy_dynamicznej"), JSON.stringify(await zdanieTaryfy()) === JSON.stringify([DYNAMICZNA]), JSON.stringify(await zdanieTaryfy()));
    await klik('input[name="rodzaj_ceny"][value="stala"]');
    await klik('input[name="taryfa"][value="g12"]');

    // Pstryk ustawia cenę dynamiczną, także po wybranej stałej; zmiana sprzedawcy niczego nie kasuje.
    const cenaStan = () => js(`({ rodzaj: document.querySelector('input[name="rodzaj_ceny"]:checked')?.value ?? '', pola: document.querySelectorAll('#cena-pola input').length,
      tryb: !document.querySelector('#cena-tryb').hidden })`);
    sprawdz(w("przed Pstrykiem: cena stała, G12 z dwoma polami stref, bez wyboru"), JSON.stringify(await cenaStan()) === JSON.stringify({ rodzaj: "stala", pola: 2, tryb: false }), JSON.stringify(await cenaStan()));
    await klik('input[name="sprzedawca"][value="pstryk"]');
    sprawdz(w("Pstryk: zaznaczona cena dynamiczna, jedno pole ceny bez wyboru stref, zdanie dla ceny dynamicznej"),
      JSON.stringify(await cenaStan()) === JSON.stringify({ rodzaj: "dynamiczna", pola: 1, tryb: false }) && JSON.stringify(await zdanieTaryfy()) === JSON.stringify([DYNAMICZNA]), JSON.stringify(await cenaStan()));
    await klik('input[name="sprzedawca"][value="tauron_sprzedaz"]');
    sprawdz(w("zmiana sprzedawcy z Pstryka: cena dynamiczna zostaje"), (await cenaStan()).rodzaj === "dynamiczna");
    await klik('input[name="rodzaj_ceny"][value="stala"]');
    sprawdz(w("cenę dynamiczną da się zmienić na stałą"), (await cenaStan()).rodzaj === "stala" && (await cenaStan()).pola === 2);

    // Sprzedawca z listy wpisany jako „inny”.
    await klik('input[name="sprzedawca"][value="inny"]');
    const naLiscie = () => js(`(() => { const u = document.querySelector('#sprzedawca-na-liscie'); return !u.hidden && u.getClientRects().length > 0 && u.className === 'uwaga' && u.textContent; })()`);
    await wpisz("#p-sprzedawca_nazwa", "Tauron Sprzedaż", "input");
    await czekaj(500);
    sprawdz(w("„inny” + „Tauron Sprzedaż”: uwaga sprzedawca_na_liscie pod polem, zapis możliwy"),
      (await naLiscie()) === "Ten sprzedawca jest na liście powyżej. Możesz go tam wybrać albo zostawić swój wpis." && !(await js("document.querySelector('#zapisz').disabled")) &&
      (await tekstEl("#podglad")).includes('"sprzedawca_nazwa": "Tauron Sprzedaż"'), String(await naLiscie()));
    await wpisz("#p-sprzedawca_nazwa", "Moja spółdzielnia", "input");
    await czekaj(500);
    sprawdz(w("„inny” + „Moja spółdzielnia”: bez uwagi"), (await naLiscie()) === false);
    await klik('input[name="sprzedawca"][value="tauron_sprzedaz"]');
    sprawdz(w("inny sprzedawca z listy: uwaga znika"), (await naLiscie()) === false);

    // „Inny okres” wpisuje daty z wybranego miesiąca; wpisanych dat nie nadpisuje.
    await wybierzMiesiac("01", "2026");
    await czekaj(300);
    await klik("#p-okres-inny");
    const daty = () => js("document.querySelector('#p-okres_od').value + '/' + document.querySelector('#p-okres_do').value");
    sprawdz(w("„inny okres” po styczniu 2026: daty 2026-01-01 i 2026-01-31"), (await daty()) === "2026-01-01/2026-01-31", await daty());
    await wpisz("#p-okres_od", "2026-01-05");
    await klik("#p-okres-inny");
    await wybierzMiesiac("03", "2025");
    await czekaj(300);
    await klik("#p-okres-inny");
    sprawdz(w("ponowne zaznaczenie po zmianie miesiąca: wpisane daty zostają"), (await daty()) === "2026-01-05/2026-01-31", await daty());
    await klik("#p-okres-inny");
    await wybierzMiesiac("01", "2026");
    await czekaj(300);

    // Cena wpisana jak przez klienta i wyjście z pola: „1” -> „1,00”, „51” -> błąd groszy. Jedno
    // pole ceny przy G11 (G12 ma od wersji 0.1.5 od razu pola stref).
    await klik('input[name="taryfa"][value="g11"]');
    const wpiszCene = async (tekst) => {
      await js("(() => { const e = document.querySelector('#p-cena'); e.focus(); e.select(); })()");
      await strona("Input.insertText", { text: tekst });
      await js("document.querySelector('#p-moc_pv_kwp').focus()");
      await czekaj(400);
    };
    await wpiszCene("1");
    sprawdz(w("cena „1” po wyjściu z pola: „1,00”, w faktury.json \"1.00\""),
      (await js("document.querySelector('#p-cena').value")) === "1,00" && (await tekstEl("#podglad")).includes('"cena_energii_netto_zl_kwh": "1.00"'), await js("document.querySelector('#p-cena').value"));
    await wpiszCene("51");
    const bladCeny = await tekstEl('[data-pole="cena_energii_netto_zl_kwh"] > .blad');
    sprawdz(w("cena „51”: błąd faktura_cena_grosze przy polu, wartość bez zmian, zapis zablokowany"),
      bladCeny === "Cena wygląda na podaną w groszach. Wpisz ją w złotych, na przykład 0,62." && (await js("document.querySelector('#p-cena').value")) === "51" &&
      await js("document.querySelector('#zapisz').disabled") && (await tekstEl("#zapis-powod")).includes("cena energii"), bladCeny);
    await wpiszCene("0,62");
    sprawdz(w("cena „0,62”: bez błędu, zapis możliwy"), (await tekstEl('[data-pole="cena_energii_netto_zl_kwh"] > .blad')) === "" && !(await js("document.querySelector('#zapisz').disabled")));

    // Dwa pliki o tych samych wartościach z różnym PPE: blokada, nie duplikat.
    await ustawPliki([plikStyczenInnyPpe]);
    const plakietki = await js("[...document.querySelectorAll('.plakietka')].map(e => e.textContent)");
    sprawdz(w("ten sam styczeń z innym PPE: oba pliki przyjęte, blad_rozne_ppe, zapis zablokowany, bez komunikatu o duplikacie"),
      JSON.stringify(plakietki) === JSON.stringify(["Przyjęty", "Przyjęty"]) && (await tekstEl("#blokady")).includes("Te pliki pochodzą z różnych punktów poboru.") &&
      !(await tekstEl("#lista-plikow")).includes("Taki sam plik") && await js("document.querySelector('#zapisz').disabled"), `${plakietki.join(", ")} | ${await tekstEl("#blokady")}`);
    await js("document.querySelectorAll('.plik')[1].querySelector('button').click()");
    await czekaj(800);
    sprawdz(w("po usunięciu pliku z innym PPE zapis znów możliwy"), !(await js("document.querySelector('#zapisz').disabled")));

    // Zmiana pola tuż przed zapisem (w ciągu 250 ms): bez nieaktualnego potwierdzenia.
    if (await widoczny("#droga-udostepnianie")) await klik("#droga-zapis-pokaz");
    const przed = zapisy();
    await js("document.querySelector('#zapisz').click()");
    for (let i = 0; i < 40 && zapisy() <= przed; i++) await czekaj(250);
    const stanZapisu = () => js(`(() => { const widac = (s) => { const e = document.querySelector(s); return !e.hidden && e.getClientRects().length > 0; };
      return { gotowe: widac('#zapis-gotowe'), poZapisie: widac('#po-zapisie'), href: document.querySelector('#mailto').hasAttribute('href') }; })()`);
    sprawdz(w("zapis: potwierdzenie i aktywna wiadomość"), zapisy() === przed + 1 && JSON.stringify(await stanZapisu()) === JSON.stringify({ gotowe: true, poZapisie: true, href: true }), JSON.stringify(await stanZapisu()));
    const tuzPo = await js(`(() => { const e = document.querySelector('#p-cena'); e.value = '51'; e.dispatchEvent(new Event('input', { bubbles: true }));
      const t0 = performance.now(); document.querySelector('#zapisz').click();
      const widac = (s) => { const x = document.querySelector(s); return !x.hidden && x.getClientRects().length > 0; };
      return { ms: performance.now() - t0, gotowe: widac('#zapis-gotowe'), poZapisie: widac('#po-zapisie'), href: document.querySelector('#mailto').hasAttribute('href'),
        zablokowany: document.querySelector('#zapisz').disabled }; })()`);
    await czekaj(1000);
    sprawdz(w("zła cena i kliknięcie zapisu przed przeliczeniem: bez potwierdzenia i komunikatu po zapisie, wiadomość bez href, bez nowego pliku"),
      !tuzPo.gotowe && !tuzPo.poZapisie && !tuzPo.href && tuzPo.zablokowany && zapisy() === przed + 1 && JSON.stringify(await stanZapisu()) === JSON.stringify({ gotowe: false, poZapisie: false, href: false }), JSON.stringify(tuzPo));
    await wpiszCene("0,62");
    sprawdz(w(`${px} px: bez poziomego przewijania`), (await js("document.documentElement.scrollWidth")) <= px);
    await zrzut(`6-wersja-0-1-4-${wariant}`, px);
  };
  await proba014("zwykły ekran", 1280);

  // 6b3. Zmiany z wersji 0.1.5, na świeżo otwartej stronie z plikiem stycznia. Wywoływane w obu
  // wariantach: zwykły ekran z kursorem (tu) i telefon z ekranem dotykowym (w 6c).
  const proba015 = async (wariant, px) => {
    const w = (opis) => `${wariant}: ${opis}`;
    await otworz();
    await ustawPliki([plikStyczen]);

    // Nagłówek: napis-odnośnik nad tytułem (bez klikania, żeby nie otwierać karty), akapit o operatorze.
    const naglowek = await js(`(() => { const t = document.querySelector('header.naglowek .tresc'); const a = t.querySelector('a'); const h1 = t.querySelector('h1');
      const akapity = [...t.querySelectorAll('p')].filter((p) => !p.hidden && p.getClientRects().length > 0);
      return { tekst: a?.textContent, href: a?.getAttribute('href'), target: a?.getAttribute('target'), rel: a?.getAttribute('rel'),
        widoczny: Boolean(a) && a.getClientRects().length > 0, nadTytulem: Boolean(a && h1) && Boolean(a.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING),
        akapity: akapity.map((p) => p.dataset.tekst), operator: akapity[1]?.textContent }; })()`);
    sprawdz(w("nagłówek: „ProsumentLab” nad tytułem, odnośnik do / w nowej karcie, rel noopener noreferrer"),
      naglowek.tekst === "ProsumentLab" && naglowek.href === "/" && naglowek.target === "_blank" && naglowek.rel === "noopener noreferrer" && naglowek.widoczny && naglowek.nadTytulem, JSON.stringify(naglowek));
    sprawdz(w("akapit o operatorze widoczny pod opisem"),
      JSON.stringify(naglowek.akapity) === JSON.stringify(["wstep_opis", "wstep_operator"]) &&
      naglowek.operator === "Na razie narzędzie przyjmuje pliki z eLicznika Taurona. Nad plikami od innych operatorów pracujemy.", JSON.stringify(naglowek));

    // Pola ceny przy cenie stałej: G12, G12w, G13 od razu pola stref z podpowiedzią, bez wyboru.
    const stanCen = () => js(`(() => { const widac = (s) => { const e = document.querySelector(s); return Boolean(e) && !e.hidden && e.getClientRects().length > 0; };
      return { wybor: widac('#cena-tryb'), podpowiedz: widac('#cena-strefy-jedna'),
        etykiety: [...document.querySelectorAll('#cena-pola input')].map((e) => e.labels?.[0]?.textContent ?? e.getAttribute('aria-label')) }; })()`);
    const pomoc = () => js(`[...document.querySelectorAll('[data-pole="cena_energii_netto_zl_kwh"] details p')].filter((p) => !p.hidden).map((p) => p.textContent)`);
    const JEDNA = "Cena energii czynnej netto, zł/kWh";
    await klik('input[name="system_rozliczenia"][value="net_billing_rce"]');
    await klik('input[name="rodzaj_ceny"][value="stala"]');
    for (const [taryfa, oczekiwany] of [
      ["g12", { wybor: false, podpowiedz: true, etykiety: ["strefa dzienna", "strefa nocna"] }],
      ["g12w", { wybor: false, podpowiedz: true, etykiety: ["strefa szczytowa", "strefa pozaszczytowa"] }],
      ["g13", { wybor: false, podpowiedz: true, etykiety: ["szczyt przedpołudniowy", "szczyt popołudniowy", "pozostałe godziny doby"] }],
      ["g11", { wybor: false, podpowiedz: false, etykiety: [JEDNA] }],
      ["inna", { wybor: true, podpowiedz: false, etykiety: [JEDNA] }],
    ]) {
      await klik(`input[name="taryfa"][value="${taryfa}"]`);
      const stan = await stanCen();
      sprawdz(w(`cena stała, ${taryfa}: ${oczekiwany.wybor ? "wybór jednej ceny" : "bez wyboru"}, ${oczekiwany.podpowiedz ? "z podpowiedzią" : "bez podpowiedzi"}, pola ${oczekiwany.etykiety.join(" / ")}`),
        JSON.stringify(stan) === JSON.stringify(oczekiwany), JSON.stringify(stan));
    }
    await klik('input[name="cena_tryb"][value="strefy"]');
    sprawdz(w("„inna” + osobna cena w każdej strefie: pole „strefa 1”, bez podpowiedzi o jednej cenie"),
      JSON.stringify(await stanCen()) === JSON.stringify({ wybor: true, podpowiedz: false, etykiety: ["strefa 1"] }), JSON.stringify(await stanCen()));
    await klik('input[name="cena_tryb"][value="jedna"]');

    await klik('input[name="taryfa"][value="g12"]');
    sprawdz(w("G12: podpowiedź cena_strefy_jedna i pomoc do ceny stałej"),
      (await tekstEl("#cena-strefy-jedna")) === "Jeśli faktura podaje jedną cenę dla wszystkich stref, wpisz ją w każde pole." &&
      JSON.stringify(await pomoc()) === JSON.stringify(["Cena netto za 1 kWh z części faktury o sprzedaży energii (punkt 6 na rysunku)."]), JSON.stringify(await pomoc()));
    const bladCeny = () => tekstEl('[data-pole="cena_energii_netto_zl_kwh"] > .blad');
    await wpisz("#p-cena-0", "0,60", "input");
    await czekaj(500);
    sprawdz(w("G12, cena tylko w jednym polu: błąd faktura_strefy_liczba, zapis zablokowany"),
      (await bladCeny()) === "Wpisz wartość w każdej strefie albo wyczyść te pola." && await js("document.querySelector('#zapisz').disabled"), await bladCeny());
    await wpisz("#p-cena-1", "0,60", "input");
    await czekaj(500);
    sprawdz(w("G12, ta sama cena w obu polach: bez błędu, zapis możliwy, dwie ceny w faktury.json"),
      (await bladCeny()) === "" && !(await js("document.querySelector('#zapisz').disabled")) && /"cena_energii_netto_zl_kwh": \[\s*"0\.60",\s*"0\.60"\s*\]/.test(await tekstEl("#podglad")), await bladCeny());

    await klik('input[name="rodzaj_ceny"][value="dynamiczna"]');
    sprawdz(w("G12 przy cenie dynamicznej: jedno pole, bez wyboru i podpowiedzi, pomoc z tabelą Taurona"),
      JSON.stringify(await stanCen()) === JSON.stringify({ wybor: false, podpowiedz: false, etykiety: ["Średnia cena energii z faktury, netto, zł/kWh"] }) &&
      JSON.stringify(await pomoc()) === JSON.stringify(["Przy cenie dynamicznej faktura podaje średnią cenę za 1 kWh w okresie rozliczeniowym. Wpisz ją netto. Na fakturze Taurona znajdziesz ją w tabeli „Szczegóły kalkulacji ceny energii ważonej zużyciem”, w kolumnie „Cena netto”. Jeśli jej nie znajdziesz, zostaw pole puste."]),
      `${JSON.stringify(await stanCen())} ${JSON.stringify(await pomoc())}`);

    // Granica nietypowej ceny: 2,00 zł/kWh.
    await klik('input[name="rodzaj_ceny"][value="stala"]');
    await klik('input[name="taryfa"][value="g11"]');
    await wpisz("#p-cena", "1,80", "input");
    await czekaj(500);
    sprawdz(w("G11, cena 1,80: bez uwagi o nietypowej cenie"), !(await widoczny("#faktura-cena-nietypowa")) && (await tekstEl("#podglad")).includes('"cena_energii_netto_zl_kwh": "1.80"'));
    await wpisz("#p-cena", "2,10", "input");
    await czekaj(500);
    sprawdz(w("G11, cena 2,10: uwaga o nietypowej cenie, zapis możliwy"),
      (await widoczny("#faktura-cena-nietypowa")) && !(await js("document.querySelector('#zapisz').disabled")) && (await tekstEl("#podglad")).includes('"cena_energii_netto_zl_kwh": "2.10"'));
    sprawdz(w(`${px} px: bez poziomego przewijania`), (await js("document.documentElement.scrollWidth")) <= px);
    await zrzut(`7-wersja-0-1-5-${wariant}`, px);
  };
  await proba015("zwykły ekran", 1280);

  // 6c. Wariant 2, telefon: 390 px i ekran dotykowy z emulacji DevTools (pointer: coarse). Chromium
  // nie udostępnia plików ZIP, więc canShare, share i schowek to atrapy wstawiane przed skryptami
  // strony. Wywołania schowka i share trafiają na jedną listę, w kolejności. window.__odmowa: nazwa
  // błędu, którym odmawia share; window.__schowek: "ok", "odmowa" albo "brak" (bez schowka).
  const ATRAPY = `(() => {
    window.__wywolania = [];
    window.__odmowa = null;
    window.__schowek = "ok";
    Object.defineProperty(navigator, "canShare", { value: (d) => Array.isArray(d?.files) && d.files.length > 0, configurable: true });
    Object.defineProperty(navigator, "share", { value: async (d) => {
      window.__wywolania.push({ co: "share", pliki: d.files.map((f) => ({ nazwa: f.name, typ: f.type, rozmiar: f.size, plik: f instanceof File })), tytul: d.title, tekst: d.text,
        aktywny: navigator.userActivation ? navigator.userActivation.isActive : null });
      if (window.__odmowa) throw new DOMException("Odmowa", window.__odmowa);
    }, configurable: true });
    const schowek = { writeText: async (t) => {
      window.__wywolania.push({ co: "schowek", tekst: t });
      if (window.__schowek === "odmowa") throw new DOMException("Odmowa", "NotAllowedError");
    } };
    Object.defineProperty(navigator, "clipboard", { get: () => (window.__schowek === "brak" ? undefined : schowek), configurable: true });
  })()`;
  const { identifier: atrapy } = await strona("Page.addScriptToEvaluateOnNewDocument", { source: ATRAPY });
  await szerokosc(390);
  await strona("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await otworz();
  sprawdz("telefon: emulacja dotyku daje pointer: coarse", await js("matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches"));
  const drogaTel = () => js(`(() => { const widac = (s) => { const e = document.querySelector(s); return !e.hidden && e.getClientRects().length > 0; };
    const b = document.querySelector('#udostepnij-przycisk');
    return { udostepnianie: widac('#droga-udostepnianie'), zapis: widac('#droga-zapis'), niedostepne: widac('#udostepnij-niedostepne') && document.querySelector('#udostepnij-niedostepne').textContent,
      aktywny: !b.disabled, napis: b.textContent, podpowiedz: b.nextElementSibling.textContent, pokaz: document.querySelector('#droga-zapis-pokaz').textContent,
      fokus: document.activeElement?.id ?? '', powod: widac('#zapis-powod') && document.querySelector('#zapis-powod').textContent }; })()`);
  let dt = await drogaTel();
  sprawdz("telefon przed plikiem: tylko droga z udostępnianiem, przycisk nieaktywny, powód pod tytułem kroku",
    dt.udostepnianie && !dt.zapis && !dt.aktywny && dt.napis === "Przygotuj wiadomość z plikiem" && dt.powod === "Najpierw wybierz plik godzinowy.", JSON.stringify(dt));
  sprawdz("telefon: pod przyciskiem udostepnij_podpowiedz, niżej przycisk tekstowy droga_zapis_pokaz",
    dt.podpowiedz === "Wybierz pocztę. W polu „Do” wybierz „Wklej”: adres raporty@prosumentlab.pl jest już w schowku. Plik jest w załączniku, a temat możesz zostawić pusty." &&
    dt.pokaz === "Wolę zapisać plik i dołączyć go sam", JSON.stringify(dt));
  await ustawPliki([plikStyczen]);
  const numerTel = (await tekstEl("#numer")).match(/[0-9A-Z]{4}-[0-9A-Z]{4}/)[0];
  dt = await drogaTel();
  sprawdz("telefon z plikiem: przycisk udostępniania aktywny", dt.udostepnianie && dt.aktywny && dt.powod === false, JSON.stringify(dt));
  sprawdz("telefon 390 px, droga z udostępnianiem: bez poziomego przewijania", (await js("document.documentElement.scrollWidth")) <= 390);
  await zrzut("4-telefon-udostepnianie", 390);
  const przedTel = zapisy();
  await js("document.querySelector('#udostepnij-przycisk').click()");
  await czekaj(800);
  let wyw = await js("window.__wywolania");
  const SHARE = { tytul: `Zgłoszenie ${numerTel} do ProsumentLab`, tekst: `Dane do darmowego raportu, zgłoszenie ${numerTel}. Adres: raporty@prosumentlab.pl` };
  const shareOk = (w) => w?.co === "share" && w.pliki.length === 1 && w.pliki[0].nazwa === `prosumentlab_${numerTel}.zip` && w.pliki[0].typ === "application/zip" &&
    w.pliki[0].rozmiar > 0 && w.pliki[0].plik && w.tytul === SHARE.tytul && w.tekst === SHARE.tekst;
  sprawdz("kliknięcie: najpierw adres do schowka, potem share z jednym plikiem ZIP, tytułem i tekstem z numerem i adresem",
    wyw.length === 2 && wyw[0].co === "schowek" && wyw[0].tekst === "raporty@prosumentlab.pl" && shareOk(wyw[1]), JSON.stringify(wyw));
  sprawdz("udostępnianie niczego nie zapisuje na urządzeniu", zapisy() === przedTel && await js("document.querySelector('#zapis-gotowe').hidden"));
  await js("window.__wywolania = []; window.__schowek = 'odmowa'; document.querySelector('#udostepnij-przycisk').click()");
  await czekaj(500);
  wyw = await js("window.__wywolania");
  sprawdz("schowek odmawia: share i tak wywołane, droga bez zmian", wyw.length === 2 && wyw[0].co === "schowek" && shareOk(wyw[1]) && (await drogaTel()).udostepnianie, JSON.stringify(wyw));
  await js("window.__wywolania = []; window.__schowek = 'brak'; document.querySelector('#udostepnij-przycisk').click()");
  await czekaj(500);
  wyw = await js("window.__wywolania");
  sprawdz("bez schowka: share i tak wywołane", wyw.length === 1 && shareOk(wyw[0]), JSON.stringify(wyw));
  // Przed share() strona czeka na skompresowany ZIP. Kliknięcie z gestem użytkownika (userGesture):
  // w chwili share() aktywacja z gestu ma nadal trwać, bo bez niej przeglądarka odmówi udostępnienia.
  await js("window.__wywolania = []; window.__schowek = 'ok'");
  await strona("Runtime.evaluate", { expression: "document.querySelector('#udostepnij-przycisk').click()", userGesture: true });
  await czekaj(500);
  wyw = await js("window.__wywolania");
  sprawdz("kliknięcie z gestem: share po kompresji ZIP-a nadal w czasie aktywacji przez gest",
    wyw.length === 2 && shareOk(wyw[1]) && wyw[1].aktywny === true, JSON.stringify(wyw));
  await js("window.__wywolania = []; window.__schowek = 'ok'; window.__odmowa = 'AbortError'; document.querySelector('#udostepnij-przycisk').click()");
  await czekaj(500);
  dt = await drogaTel();
  sprawdz("zamknięcie okna udostępniania (AbortError): droga z udostępnianiem zostaje, bez komunikatu",
    (await js("window.__wywolania.length")) === 2 && dt.udostepnianie && !dt.zapis && dt.niedostepne === false, JSON.stringify(dt));
  await js("document.querySelector('#droga-zapis-pokaz').click()");
  await czekaj(300);
  dt = await drogaTel();
  sprawdz("„Wolę zapisać plik…”: droga z zapisem, bez udostepnij_niedostepne, fokus na przycisku zapisu",
    !dt.udostepnianie && dt.zapis && dt.niedostepne === false && dt.fokus === "zapisz", JSON.stringify(dt));
  await wpisz("#p-moc_pv_kwp", "5", "input");
  await czekaj(500);
  dt = await drogaTel();
  sprawdz("wybrana droga z zapisem zostaje po przeliczeniu", !dt.udostepnianie && dt.zapis, JSON.stringify(dt));

  // Nowa wizyta: odmowa udostępniania inna niż zamknięcie okna przełącza na drogę z zapisem.
  await otworz();
  await ustawPliki([plikStyczen]);
  dt = await drogaTel();
  sprawdz("nowa wizyta na telefonie: znów droga z udostępnianiem", dt.udostepnianie && !dt.zapis && dt.aktywny, JSON.stringify(dt));
  await js("window.__odmowa = 'NotAllowedError'; document.querySelector('#udostepnij-przycisk').click()");
  await czekaj(500);
  const NIEDOSTEPNE = "Ta przeglądarka nie wyśle pliku ZIP. Zapisz plik w kroku 1, a potem w kroku 2 napisz wiadomość i dołącz plik.";
  dt = await drogaTel();
  sprawdz("odmowa NotAllowedError: droga z zapisem z udostepnij_niedostepne nad krokiem 1, fokus na przycisku zapisu",
    (await js("window.__wywolania.length")) === 2 && !dt.udostepnianie && dt.zapis && dt.niedostepne === NIEDOSTEPNE && dt.fokus === "zapisz" &&
    (await js("document.querySelector('#udostepnij-niedostepne').nextElementSibling.querySelector('h3').textContent")) === "Krok 1. Zapisz plik na tym urządzeniu.", JSON.stringify(dt));
  await wpisz("#p-moc_pv_kwp", "5", "input");
  await czekaj(500);
  dt = await drogaTel();
  sprawdz("po odmowie droga z udostępnianiem nie wraca po przeliczeniu (do końca wizyty)", !dt.udostepnianie && dt.zapis && dt.niedostepne === NIEDOSTEPNE, JSON.stringify(dt));
  const przedZapisemTel = zapisy();
  await js("document.querySelector('#zapisz').click()");
  for (let i = 0; i < 40 && zapisy() <= przedZapisemTel; i++) await czekaj(250);
  const wmTel = await js("(() => { const m = document.querySelector('#mailto'); return { href: m.getAttribute('href') ?? '', aria: m.getAttribute('aria-disabled') }; })()");
  sprawdz("telefon po odmowie: zapis działa, „Napisz nową wiadomość” aktywne",
    zapisy() === przedZapisemTel + 1 && wmTel.href.startsWith("mailto:raporty@prosumentlab.pl?subject=") && wmTel.aria === null, JSON.stringify(wmTel));
  sprawdz("telefon 390 px, droga z zapisem: bez poziomego przewijania", (await js("document.documentElement.scrollWidth")) <= 390);
  await zrzut("5-telefon-odmowa-zapis", 390);
  await proba014("telefon", 390);
  await proba015("telefon", 390);
  await strona("Page.removeScriptToEvaluateOnNewDocument", { identifier: atrapy });
  await strona("Emulation.setTouchEmulationEnabled", { enabled: false });
  await szerokosc(1280);

  // 7. Czas przeliczenia po zmianie jednego pola przy czterech plikach rocznych.
  await otworz();
  await ustawPliki(plikiRoczne, 5000);
  const czas = await js(`(() => {
    const e = document.querySelector('#p-oplata_mocowa_zl_mies');
    const czasy = [];
    for (let i = 0; i < 7; i++) { e.value = '12,3' + i; const t0 = performance.now(); e.dispatchEvent(new Event('change', { bubbles: true })); czasy.push(performance.now() - t0); }
    czasy.sort((a, b) => a - b);
    return czasy[3];
  })()`);
  sprawdz("cztery pliki roczne przyjęte", (await js("[...document.querySelectorAll('.plakietka')].filter(e => e.textContent === 'Przyjęty').length")) === 4);

  // 8. Sieć, konsola, polityka treści, przechowywanie w przeglądarce.
  // Zdarzenia sieci pochodzą z karty ze stroną, więc sprawdzenie dotyczy zapytań strony. Ruch samej
  // przeglądarki jest poza nim; ten wyłączają flagi przy starcie.
  const zapytania = zdarzenia.filter((z) => z.method === "Network.requestWillBeSent").map((z) => z.params.request.url);
  // Jedyny dopuszczony adres data: to wbudowana ikona kalendarza pola daty w Chrome (obrazek SVG),
  // nie zapytanie strony. blob: to ZIP zapisywany przez stronę.
  const obce = zapytania.filter((u) => !u.startsWith(ADRES) && !u.startsWith("blob:") && !u.startsWith("data:image/svg+xml"));
  sprawdz("karta: żadnych zapytań poza lokalną stroną", obce.length === 0, obce.join(", "));
  const wlasne = [...new Set(zapytania.filter((u) => u.startsWith(ADRES)).map((u) => u.slice(ADRES.length - 1)))];
  sprawdz("karta: zapytania tylko o pliki strony", wlasne.every((u) => /^\/(?:[A-Za-z0-9_\-/]+\.(?:js|css|svg|woff2|ico))?$/.test(u)), wlasne.filter((u) => !/\.(js|css|svg|woff2|ico)$/.test(u)).join(" "));
  const bledy = zdarzenia
    .filter((z) => z.method === "Runtime.exceptionThrown" ||
      (z.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(z.params.type)) ||
      (z.method === "Log.entryAdded" && ["error", "warning"].includes(z.params.entry.level)))
    // Czcionki lokalnie nie istnieją (są na stronie), favicon.ico też: 404 rozpoznajemy po adresie.
    .filter((z) => !/favicon\.ico|\/czcionki\//.test(z.params.entry?.url ?? ""))
    .map((z) => `${z.params.entry?.text ?? z.params.exceptionDetails?.exception?.description ?? JSON.stringify(z.params.args?.map((a) => a.value ?? a.description))} ${z.params.entry?.url ?? ""}`);
  sprawdz("konsola bez błędów i naruszeń polityki treści", bledy.length === 0, bledy.join(" | "));
  sprawdz("przechowywanie w przeglądarce puste", (await js("localStorage.length + sessionStorage.length + document.cookie.length")) === 0);

  process.stdout.write(`${wyniki.join("\n")}\n\nCzas przeliczenia po zmianie pola, 4 pliki roczne: ${czas.toFixed(0)} ms (mediana z 7)\n`);
  return wyniki.some((w) => w.startsWith("BŁĄD")) ? 1 : 0;
}

let kodWyjscia = 3;
try {
  kodWyjscia = await proba();
} catch (blad) {
  if (wyniki.length) process.stdout.write(`${wyniki.join("\n")}\n`);
  process.stderr.write(`proba-przegladarki: próba przerwana: ${blad?.message ?? blad}\n`);
} finally {
  await sprzataj();
}
process.exit(kodWyjscia);
