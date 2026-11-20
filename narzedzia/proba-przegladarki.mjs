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
// Sprawdza przepływ z dokumentacji (pliki, zakres, formularz, podgląd, zapis ZIP-a, odnośnik
// mailto, blokady) na szerokości 1280 px i 390 px oraz to, że karta ze stroną nie wysyła żadnego
// zapytania poza własne pliki, nie pisze w konsoli błędów i nie zostawia niczego w przeglądarce.
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
import { generuj, PPE_FIKCYJNE } from "./generator.mjs";
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
    const rzad = document.querySelector('.przyciski-zapisu');
    const gotowe = rzad.nextElementSibling, ponownie = gotowe?.nextElementSibling, gdzie = ponownie?.nextElementSibling;
    return {
      zapis: document.querySelector('#zapisz').parentElement === rzad && gotowe?.id === 'zapis-gotowe' && gotowe.hidden &&
        ponownie?.id === 'zapis-ponownie' && ponownie.hidden && gdzie?.dataset.tekst === 'zapis_gdzie' && !gdzie.hidden && gdzie.getClientRects().length > 0,
      wysylka: document.querySelector('#udostepnij-przycisk').hidden && document.querySelector('#udostepnij-niedostepne').hidden,
      zgoda: document.querySelector('.zgoda').nextElementSibling?.dataset.tekst === 'zgoda_bez' && !document.querySelector('.zgoda').nextElementSibling.hidden,
    };
  })()`);
  sprawdz("zapis_gdzie stale pod przyciskami (potwierdzenie zapisu schowane), bez wysyłki przy zablokowanym zapisie, zgoda_bez stale pod polem zgody",
    stale.zapis && stale.wysylka && stale.zgoda, JSON.stringify(stale));
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
    klik('input[name="cena_tryb"][value="strefy"]');
    wpisz('#p-okres_od', '2026-01-01'); wpisz('#p-okres_do', '2026-01-31');
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

  // 5. Zapis ZIP-a i wiadomość. Najpierw przeglądarka bez udostępniania plików.
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
  await js("Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })");
  await przelicz();
  sprawdz("bez navigator.canShare przycisku „Wyślij plik ZIP” nie ma, choć zapis jest możliwy",
    !(await js("document.querySelector('#zapisz').disabled")) && await js("document.querySelector('#udostepnij-przycisk').hidden && document.querySelector('#udostepnij').hidden"));
  await js("document.querySelector('#zapisz').click()");
  await czekajNaPobrane(1);
  const nazwaZip = pobrane().find((n) => n === `prosumentlab_${numer}.zip`) ?? null;
  sprawdz("ZIP zapisany pod nazwą z numerem", Boolean(nazwaZip), nazwaZip ?? "brak");
  if (nazwaZip) {
    const zip = readFileSync(join(PRACA, "pobrane", nazwaZip));
    const zawartosc = czytajZip(zip);
    sprawdz("zawartość ZIP-a", JSON.stringify(zawartosc.map((p) => p.nazwa)) === JSON.stringify(["zgloszenie.json", "faktury.json", "instalacja.json", "pomiary_1.csv", "pomiary_2.csv"]));
    const z = JSON.parse(new TextDecoder().decode(zawartosc[0].bajty));
    sprawdz("zgloszenie.json: numer, zgoda, klasyfikacja", z.numer === numer && z.zgoda_przypadek_testowy === true && z.zakres.klasyfikacja === "raport");
    const tekstZip = zip.toString("latin1");
    sprawdz("w ZIP-ie nie ma numerów PPE ani płatnika ani nazw plików", !tekstZip.includes("590000000000000010") && !tekstZip.includes("10000001") && !tekstZip.includes("eLicznik"));
    const inst = JSON.parse(new TextDecoder().decode(zawartosc[2].bajty));
    sprawdz("instalacja.json z list miesiąca i roku", inst.magazyn_od === "2022-04" && inst.zmiany?.[0]?.miesiac === "2025-07", JSON.stringify(inst));
    // Rozwinięcie pozycji kliknięciem w nazwę; treść ma być równa bajtom pliku w zapisanym ZIP-ie.
    const rozwiniete = await js(`(() => {
      const wynik = {};
      for (const n of ['zgloszenie.json', 'faktury.json']) {
        const d = document.querySelector('#podglad details[data-plik="' + n + '"]');
        d.querySelector('summary').click();
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
  sprawdz("komunikat po zapisie widoczny", !(await js("document.querySelector('#po-zapisie').hidden")) && (await tekstEl("#po-zapisie-tekst")).startsWith(`Plik prosumentlab_${numer}.zip jest zapisany`));
  const mailto = await js("document.querySelector('#mailto').href");
  sprawdz("odnośnik mailto", mailto.startsWith("mailto:raporty@prosumentlab.pl?subject=Dane%20do%20darmowego%20raportu%2C%20zg%C5%82oszenie%20") &&
    mailto.endsWith(`&body=${encodeURIComponent(`Pamiętaj o załączniku: plik prosumentlab_${numer}.zip. Bez niego nie przygotujemy raportu.`)}`));
  sprawdz("po zapisie: mailto_bez_zalacznika tuż nad „Napisz wiadomość”", await js(`(() => { const u = document.querySelector('#mailto').previousElementSibling;
    return u.id === 'mailto-bez-zalacznika' && u.className === 'uwaga' && u.textContent === 'Wiadomość otworzy się bez załącznika. Zanim ją wyślesz, dołącz plik prosumentlab_${numer}.zip z folderu Pobrane.'; })()`));
  sprawdz("po zapisie: po_zapisie bez zdania o przycisku", (await tekstEl("#po-zapisie-tekst")) === `Plik prosumentlab_${numer}.zip jest zapisany na Twoim urządzeniu. Teraz wyślij go na adres raporty@prosumentlab.pl. Nie załączaj pliku pobranego prosto z eLicznika ani faktury.`);
  const adresWTekscie = await js(`(() => { const a = [...document.querySelectorAll('#po-zapisie-tekst a')];
    return a.map(x => ({ tekst: x.textContent, href: x.href, target: x.target, rowny: x.href === document.querySelector('#mailto').href })); })()`);
  sprawdz("po zapisie: adres w po_zapisie to odnośnik z tym samym mailto: co „Napisz wiadomość”",
    adresWTekscie.length === 1 && adresWTekscie[0].tekst === "raporty@prosumentlab.pl" && adresWTekscie[0].rowny && adresWTekscie[0].target === "", JSON.stringify(adresWTekscie));
  const ZAPISANO = `Zapisano plik prosumentlab_${numer}.zip.`;
  const potwierdzenie = () => js(`(() => { const g = document.querySelector('#zapis-gotowe'), p = document.querySelector('#zapis-ponownie');
    return { pod: document.querySelector('.przyciski-zapisu').nextElementSibling === g, gotowe: !g.hidden && g.getClientRects().length > 0 && g.textContent,
      ponownie: !p.hidden && p.getClientRects().length > 0 && p.textContent }; })()`);
  let pz = await potwierdzenie();
  sprawdz("po zapisie: zapis_gotowe tuż pod przyciskami, bez zapis_ponownie", pz.pod && pz.gotowe === ZAPISANO && pz.ponownie === false, JSON.stringify(pz));
  sprawdz("bez navigator.canShare przycisku „Wyślij plik ZIP” nie ma także po zapisie", await js("document.querySelector('#udostepnij').hidden && document.querySelector('#udostepnij-przycisk').getClientRects().length === 0"));
  await js("document.querySelector('#zapisz').click()");
  const poDrugim = await czekajNaPobrane(2);
  pz = await potwierdzenie();
  sprawdz("drugi zapis tej samej treści: zapis_gotowe bez zapis_ponownie", poDrugim === 2 && pz.gotowe === ZAPISANO && pz.ponownie === false, `${poDrugim} ${JSON.stringify(pz)}`);

  // Atrapy udostępniania i schowka: canShare przyjmuje pliki, share i writeText zapisują, z czym je
  // wywołano; share odmawia błędem o nazwie z window.__odmowa.
  await js(`(() => {
    window.__udostepnione = [];
    window.__skopiowane = [];
    window.__odmowa = null;
    Object.defineProperty(navigator, 'canShare', { value: (d) => Array.isArray(d?.files) && d.files.length > 0, configurable: true });
    Object.defineProperty(navigator, 'share', { value: async (d) => {
      window.__udostepnione.push({ pliki: d.files.map(f => ({ nazwa: f.name, typ: f.type, rozmiar: f.size, zip: f instanceof File })), tytul: d.title, tekst: d.text });
      if (window.__odmowa) throw new DOMException('Odmowa', window.__odmowa);
    }, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__skopiowane.push(t); } }, configurable: true });
  })()`);
  await przelicz();
  const wysylka = await js(`(() => { const b = document.querySelector('#udostepnij-przycisk'), k = document.querySelector('#kopiuj-adres');
    return { obok: b.parentElement.className === 'przyciski-zapisu' && b.previousElementSibling?.id === 'zapisz', widoczny: !b.hidden && b.getClientRects().length > 0,
      napis: b.textContent, podpowiedz: document.querySelector('#udostepnij .podpowiedz').textContent, blok: !document.querySelector('#udostepnij').hidden,
      kopiuj: !k.hidden && k.textContent, poZapisie: document.querySelector('#po-zapisie').hidden && document.querySelector('#zapis-gotowe').hidden }; })()`);
  sprawdz("z navigator.canShare przycisk „Wyślij plik ZIP” obok przycisku zapisu, zanim cokolwiek zapisano na nowo",
    wysylka.obok && wysylka.widoczny && wysylka.napis === "Wyślij plik ZIP" && wysylka.blok, JSON.stringify(wysylka));
  sprawdz("pod przyciskami: udostepnij_podpowiedz i „Kopiuj adres”",
    wysylka.podpowiedz === "Wybierz aplikację poczty, a w polu adresata wpisz albo wklej raporty@prosumentlab.pl. Plik będzie już w załączniku." && wysylka.kopiuj === "Kopiuj adres");
  sprawdz("przeliczenie po zmianie pola chowa potwierdzenie zapisu i komunikat po zapisie", wysylka.poZapisie);
  await wpisz("#p-oplata_mocowa_zl_mies", "12,341");
  await czekaj(300);
  sprawdz("przy zablokowanym zapisie przycisku wysyłki nie ma", await js("document.querySelector('#zapisz').disabled && document.querySelector('#udostepnij-przycisk').hidden && document.querySelector('#udostepnij').hidden"));
  await przelicz();
  const przedWysylka = zapisy();
  await js("document.querySelector('#udostepnij-przycisk').click()");
  await czekaj(800);
  const udostepnione = await js("window.__udostepnione");
  sprawdz("share bez zapisu: jeden plik prosumentlab_<numer>.zip, typ application/zip, tytuł i tekst z numerem",
    udostepnione.length === 1 && udostepnione[0].pliki.length === 1 && udostepnione[0].pliki[0].nazwa === `prosumentlab_${numer}.zip` &&
    udostepnione[0].pliki[0].typ === "application/zip" && udostepnione[0].pliki[0].rozmiar > 0 && udostepnione[0].pliki[0].zip &&
    udostepnione[0].tytul === `Zgłoszenie ${numer} do ProsumentLab` && udostepnione[0].tekst === `Dane do darmowego raportu, zgłoszenie ${numer}`, JSON.stringify(udostepnione));
  sprawdz("wysyłka niczego nie zapisuje na urządzeniu i nie pokazuje potwierdzenia zapisu",
    zapisy() === przedWysylka && await js("document.querySelector('#zapis-gotowe').hidden && document.querySelector('#po-zapisie').hidden"));
  await js("document.querySelector('#kopiuj-adres').click()");
  await czekaj(200);
  sprawdz("„Kopiuj adres”: writeText z adresem, na chwilę „Adres skopiowany”",
    JSON.stringify(await js("window.__skopiowane")) === JSON.stringify(["raporty@prosumentlab.pl"]) && (await tekstEl("#kopiuj-adres")) === "Adres skopiowany");
  await czekaj(2200);
  sprawdz("po chwili przycisk znów mówi „Kopiuj adres”", (await tekstEl("#kopiuj-adres")) === "Kopiuj adres");
  await js("Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })");
  await przelicz();
  sprawdz("bez dostępu do schowka przycisku „Kopiuj adres” nie ma, wysyłka zostaje",
    await js("document.querySelector('#kopiuj-adres').hidden && !document.querySelector('#udostepnij-przycisk').hidden"));
  await js("window.__odmowa = 'AbortError'; document.querySelector('#udostepnij-przycisk').click()");
  await czekaj(300);
  sprawdz("zamknięcie okna udostępniania (AbortError) nie chowa przycisku",
    (await js("window.__udostepnione.length")) === 2 && await js("!document.querySelector('#udostepnij-przycisk').hidden && document.querySelector('#udostepnij-niedostepne').hidden"));

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
  await zrzut("3-po-zapisie-telefon", 390);
  await szerokosc(1280);

  await js("window.__odmowa = 'NotAllowedError'; document.querySelector('#udostepnij-przycisk').click()");
  await czekaj(300);
  const odmowa = async () => js(`(() => { const n = document.querySelector('#udostepnij-niedostepne');
    return { przycisk: document.querySelector('#udostepnij-przycisk').hidden && document.querySelector('#udostepnij').hidden,
      komunikat: !n.hidden && n.getClientRects().length > 0 && n.textContent, miejsce: n.previousElementSibling?.id }; })()`);
  const NIEDOSTEPNE = "Ta przeglądarka nie wyśle pliku ZIP. Zapisz plik, a potem użyj przycisku „Napisz wiadomość” i dołącz go do wiadomości.";
  let od = await odmowa();
  sprawdz("odmowa NotAllowedError: przycisk i podpowiedź znikają, w ich miejscu udostepnij_niedostepne",
    (await js("window.__udostepnione.length")) === 3 && od.przycisk && od.komunikat === NIEDOSTEPNE && od.miejsce === "udostepnij", JSON.stringify(od));
  await zrzut("4-odmowa-wysylki-telefon", 390);
  await szerokosc(1280);
  await przelicz();
  od = await odmowa();
  sprawdz("po odmowie przycisk nie wraca po przeliczeniu (do końca wizyty)", od.przycisk && od.komunikat === NIEDOSTEPNE && !(await js("document.querySelector('#zapisz').disabled")), JSON.stringify(od));

  // 5b. System opustów, cena dynamiczna, korekta, okres: na wypełnionym formularzu.
  const klik = async (wybor) => {
    await js(`document.querySelector(${JSON.stringify(wybor)}).click()`);
    await czekaj(300);
  };
  const widoczny = (wybor) => js(`(() => { const e = document.querySelector(${JSON.stringify(wybor)}); return Boolean(e) && !e.hidden && e.getClientRects().length > 0; })()`);
  await klik('input[name="system_rozliczenia"][value="opusty"]');
  // Treść faktury.json z podglądu: <pre> tuż po nagłówku z nazwą pliku.
  const fakturyWPodgladzie = () => js("document.querySelector('#podglad details[data-plik=\"faktury.json\"] pre')?.textContent ?? ''");
  let podgladTeraz = await fakturyWPodgladzie();
  sprawdz("opusty: pozostałe pola faktury schowane, tekst o opustach widoczny",
    !(await widoczny("#faktura-pola")) && !(await widoczny("#p-okres_od")) && (await tekstEl('[data-pole="system_rozliczenia"] .uwaga')).startsWith("Raportu dla systemu opustów jeszcze nie mamy"));
  sprawdz("opusty: w podglądzie faktury.json tylko operator i system, bez wcześniej wpisanych pól",
    podgladTeraz.includes('"operator_dystrybucyjny": "tauron_dystrybucja",\n    "system_rozliczenia": "opusty"\n  }') &&
    !podgladTeraz.includes('"sprzedawca"') && !podgladTeraz.includes('"oplata_mocowa_zl_mies"') && !podgladTeraz.includes("2026-01-01"), podgladTeraz);
  sprawdz("opusty: bez uwagi o brakujących polach, zapis możliwy", await js("document.querySelector('#faktura-brak').hidden") && !(await js("document.querySelector('#zapisz').disabled")));
  await klik('input[name="system_rozliczenia"][value="net_billing_rce"]');
  podgladTeraz = await fakturyWPodgladzie();
  sprawdz("po powrocie z opustów wpisane wartości wracają na stronę i do podglądu",
    (await widoczny("#p-okres_od")) && (await js("document.querySelector('#p-okres_od').value")) === "2026-01-01" &&
    podgladTeraz.includes('"sprzedawca": "tauron_sprzedaz"') && podgladTeraz.includes('"oplata_mocowa_zl_mies": "12.34"'));

  await klik('input[name="rodzaj_ceny"][value="dynamiczna"]');
  const dyn = await js(`(() => ({
    tryb: document.querySelector('#cena-tryb').hidden,
    pola: document.querySelectorAll('#cena-pola input').length,
    etykieta: [...document.querySelectorAll('[data-pole="cena_energii_netto_zl_kwh"] legend span:not(.nr)')].filter(s => !s.hidden).map(s => s.textContent).join("|"),
    aria: document.querySelector('#p-cena')?.getAttribute('aria-label'),
  }))()`);
  sprawdz("cena dynamiczna: jedno pole, bez wyboru stref, własna etykieta",
    dyn.tryb && dyn.pola === 1 && dyn.etykieta === "Średnia cena energii z faktury, netto, zł/kWh" && dyn.aria === dyn.etykieta, JSON.stringify(dyn));
  await wpisz("#p-cena", "1,60", "input");
  await czekaj(500);
  sprawdz("cena dynamiczna 1,60: uwaga o nietypowej cenie, zapis możliwy",
    (await widoczny("#faktura-cena-nietypowa")) && !(await js("document.querySelector('#zapisz').disabled")) && (await tekstEl("#podglad")).includes('"cena_energii_netto_zl_kwh": "1.60"'));
  await klik('input[name="rodzaj_ceny"][value="stala"]');
  sprawdz("powrót do ceny stałej: ceny w strefach wracają", JSON.stringify(await js("[...document.querySelectorAll('#cena-pola input')].map(e => e.value)")) === JSON.stringify(["0,60000", "0,70000", "0,40000"]) && !(await widoczny("#faktura-cena-nietypowa")));

  await klik("#p-korekta");
  sprawdz("korekta: pole wyboru, podpowiedź i „korekta” w faktury.json", (await widoczny("#korekta-podpowiedz")) && (await tekstEl("#podglad")).includes('"rodzaj_faktury": "korekta"'));
  await klik("#p-korekta");

  await wpisz("#p-okres_do", "2099-12-31");
  await czekaj(300);
  sprawdz("okres z przyszłości: błąd przy polu i blokada zapisu",
    (await tekstEl('[data-pole="okres_do"] .blad')).startsWith("Koniec okresu jest późniejszy niż dzisiejsza data.") && await js("document.querySelector('#zapisz').disabled"));
  await wpisz("#p-okres_do", "2026-01-31");
  await wpisz("#p-okres_od", "2025-10-01");
  await czekaj(300);
  sprawdz("okres dłuższy niż 62 dni: uwaga, zapis możliwy", (await widoczny("#faktura-okres-dlugi")) && !(await js("document.querySelector('#zapisz').disabled")));
  await wpisz("#p-okres_od", "2026-01-01");
  await czekaj(300);

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
  await js(`(() => { document.querySelector('input[name="taryfa"][value="g12"]').click(); document.querySelector('input[name="cena_tryb"][value="strefy"]').click(); })()`);
  await czekaj(300);
  sprawdz("G12: bez podpowiedzi o kolejności stref", await js("document.querySelector('#strefy-kolejnosc').hidden"));
  await js(`document.querySelector('input[name="taryfa"][value="inna"]').click()`);
  await czekaj(300);
  sprawdz("taryfa inna: podpowiedź o kolejności stref", !(await js("document.querySelector('#strefy-kolejnosc').hidden")));
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
