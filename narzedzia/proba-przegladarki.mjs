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
// Sprawdza kreator w dwóch wariantach: zwykły ekran (1280 px) i telefon (390 px z emulacją ekranu
// dotykowego, pointer: coarse). W każdym: przejście przez sześć kroków, „Dalej” zatrzymane błędem
// w polu i niezatrzymane brakiem danych z faktury, „Wstecz” bez utraty danych, rozmiar ZIP-a po
// kompresji, wysyłka z każdą odpowiedzią atrapy przyjmowania zgłoszeń (serwer z opcją zgłoszeń;
// odpowiedź wybiera część adresu przed „@”), droga zapasowa (zapis i wiadomość) i pytanie przed
// opuszczeniem strony (beforeunload); Enter w polu adresu niczego nie wysyła. Do tego: wysyłka
// niedostępna pod inną nazwą serwera niż 127.0.0.1 i localhost (także kliknięcie ukrytego przycisku
// nie wysyła żądania), ciało wysłanego żądania równe zapisanemu plikowi ZIP, podwójne kliknięcie
// „Wyślij zgłoszenie” z jednym żądaniem, ZIP ponad limit wysyłki (przeglądarka bez
// CompressionStream), nieudana kompresja (ZIP metodą 0) i nieudana budowa ZIP-a (blad_nieznany,
// ponowienie przy kolejnym wejściu na krok), formularz (opusty, ceny, okres, magazyn), blokady
// (także blokada z pól wpisanych ręcznie, która zatrzymuje „Dalej” w kroku z polem) i lista
// plików, zmiany z wersji 0.1.4 i 0.1.5 w obu wariantach. Na końcu: karta ze stroną nie wysyła żadnego zapytania poza 127.0.0.1 i poza własne
// pliki oraz POST pod /zgloszenie/, nie pisze w konsoli błędów i nie zostawia niczego w przeglądarce.
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
import { CZAS_WYSYLKI_MS } from "../app/lib/wysylka.js";
import { rozmiarDoWyswietlenia } from "../app/lib/odmiana.js";

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
  // Sześć lat: bez kompresji ZIP ma ponad 5 MiB (limit wysyłki przez stronę).
  const plikiSzesciuLat = [2018, 2019, 2020, 2021, 2022, 2023].map((r) => plik(`lata_${r}.csv`, generuj({ od: `${r}-01-01`, do: `${r}-12-31`, ziarno: 3 }).surowy));
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

  // Serwer z atrapą przyjmowania zgłoszeń: odpowiedź wybiera część adresu e-mail przed „@”.
  serwer = utworzSerwer(undefined, { zgloszenie: true });
  await new Promise((ok) => serwer.listen(0, "127.0.0.1", ok));
  const PORT = serwer.address().port;
  const ADRES = `http://127.0.0.1:${PORT}/`;
  // Ta sama strona pod nazwą inną niż 127.0.0.1 i localhost, jak serwer próbny w sieci domowej:
  // wysyłka przez stronę ma być niedostępna. Nazwa w domenie .invalid prowadzi do 127.0.0.1 tylko
  // w tej przeglądarce (--host-resolver-rules), więc nie wychodzi do żadnego serwera nazw.
  const ADRES_INNY = `http://proba.invalid:${PORT}/`;
  const ZGLOSZENIE = `${ADRES}zgloszenie/`;

  // Jedyne adresy, jakie przeglądarka dostaje od skryptu, to about:blank, ADRES i ADRES_INNY.
  // Flagi wyłączają jej własny ruch w tle (aktualizacje składników, synchronizację, pingi) i dostęp
  // do pęku kluczy systemu, żeby nic nie wychodziło poza katalog tymczasowy i poza 127.0.0.1.
  chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-pings",
    "--use-mock-keychain", "--password-store=basic", "--host-resolver-rules=MAP proba.invalid 127.0.0.1",
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
  // Limit czasu wysyłki (120 s) skrócony w próbie do 2 s, żeby odpowiedź „brak-odpowiedzi” nie
  // trzymała próby dwie minuty. Podmiana dotyczy tylko tej jednej wartości i działa przed skryptami
  // strony; kod strony zostaje bez zmian.
  await strona("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const st = window.setTimeout;
    window.setTimeout = function (f, ms, ...a) { return st.call(window, f, ms === ${CZAS_WYSYLKI_MS} ? 2000 : ms, ...a); }; })()` });

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
  let biezacaSzerokosc = 1280;
  async function zrzut(nazwa) {
    const { cssContentSize } = await strona("Page.getLayoutMetrics");
    const { data } = await strona("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: biezacaSzerokosc, height: Math.ceil(cssContentSize.height), scale: 1 } });
    writeFileSync(join(PRACA, "zrzuty", `${nazwa}.png`), Buffer.from(data, "base64"));
  }
  async function ustawPliki(sciezki, ms = 1500) {
    const { root } = await strona("DOM.getDocument");
    const { nodeId } = await strona("DOM.querySelector", { nodeId: root.nodeId, selector: "#wybor-plikow" });
    await strona("DOM.setFileInputFiles", { nodeId, files: sciezki });
    await czekaj(ms);
  }
  // Przejście na adres. Gdy strona pyta przed opuszczeniem (beforeunload, przeglądarka pokazuje
  // pytanie tylko po działaniu użytkownika na stronie), przejście czeka na odpowiedź: próba
  // odpowiada „opuść” i zwraca rodzaj okna, inaczej null.
  async function otworz(adres = ADRES) {
    const od = zdarzenia.length;
    let skonczone = false;
    const przejscie = strona("Page.navigate", { url: adres }).finally(() => {
      skonczone = true;
    });
    let okno = null;
    for (let i = 0; i < 50 && !skonczone && !okno; i++) {
      okno = zdarzenia.slice(od).find((z) => z.method === "Page.javascriptDialogOpening")?.params.type ?? null;
      if (!okno) await czekaj(100);
    }
    if (okno) await strona("Page.handleJavaScriptDialog", { accept: true });
    await przejscie;
    await czekaj(1500);
    return okno;
  }
  const wpisz = (wybor, wartosc, zdarzenie = "change") =>
    js(`(() => { const e = document.querySelector(${JSON.stringify(wybor)}); e.value = ${JSON.stringify(wartosc)}; e.dispatchEvent(new Event(${JSON.stringify(zdarzenie)}, { bubbles: true })); })()`);
  const tekstEl = (wybor) => js(`document.querySelector(${JSON.stringify(wybor)})?.textContent ?? ""`);
  const klik = async (wybor) => {
    await js(`document.querySelector(${JSON.stringify(wybor)}).click()`);
    await czekaj(300);
  };
  const widoczny = (wybor) => js(`(() => { const e = document.querySelector(${JSON.stringify(wybor)}); return Boolean(e) && !e.hidden && e.getClientRects().length > 0; })()`);
  const bezPrzewijaniaWPoziomie = async (px) => (await js("document.documentElement.scrollWidth")) <= px;
  // Zapis i wysyłka są możliwe, gdy nie ma powodu blokady (powód stoi w kroku 6, także gdy krok
  // jest schowany); sam przycisk jest aktywny dopiero przy gotowym ZIP-ie (kroki 5 i 6).
  const zapisMozliwy = () => js("document.querySelector('#zapis-powod').textContent === ''");

  // Kreator.
  const krok = () => js("Number(document.querySelector('section.krok:not([hidden])')?.dataset.krok ?? 0)");
  const dalej = async () => {
    await js("document.querySelector('#kreator-dalej').click()");
    await czekaj(400);
  };
  const wstecz = async () => {
    await js("document.querySelector('#kreator-wstecz').click()");
    await czekaj(400);
  };
  // Przejście do kroku `n` przyciskami kreatora; false, gdy „Dalej” zatrzymało.
  async function naKrok(n) {
    for (let i = 0; i < 10; i++) {
      const k = await krok();
      if (k === n) return true;
      if (k < n) await dalej();
      else await wstecz();
      if ((await krok()) === k) return false;
    }
    return (await krok()) === n;
  }
  const stanKreatora = () => js(`(() => { const widac = (s) => { const e = document.querySelector(s); return Boolean(e) && !e.hidden && e.getClientRects().length > 0; };
    const s = document.querySelector('section.krok:not([hidden])');
    return { krok: Number(s?.dataset.krok ?? 0), widoczne: document.querySelectorAll('section.krok:not([hidden])').length,
      napis: document.querySelector('#kreator-krok').textContent, pasek: document.querySelectorAll('#pasek span.zrobiony').length,
      pasekUkryty: document.querySelector('#pasek').getAttribute('aria-hidden') === 'true',
      wstecz: widac('#kreator-wstecz'), dalej: widac('#kreator-dalej'), dalejAktywny: !document.querySelector('#kreator-dalej').disabled,
      fokusNaglowek: document.activeElement === s?.querySelector('h1'), przewiniecie: Math.round(window.scrollY),
      przyklejony: getComputedStyle(document.querySelector('#kreator-przyciski')).position !== 'static',
      komunikat: (() => { const k = s?.querySelector('.kreator-komunikat'); return Boolean(k) && widac('section.krok:not([hidden]) .kreator-komunikat') && k.textContent; })(),
      fokus: document.activeElement === s?.querySelector('.kreator-komunikat') ? 'komunikat' : (document.activeElement?.id || document.activeElement?.tagName || '') }; })()`);
  // Pytanie przy opuszczaniu strony: zdarzenie beforeunload, które strona odwołuje.
  const pytaPrzedWyjsciem = () => js("(() => { const z = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(z); return z.defaultPrevented; })()");
  // Żądania pod /zgloszenie/ ze zdarzeń sieci karty.
  const zgloszenia = () => zdarzenia.filter((z) => z.method === "Network.requestWillBeSent" && z.params.request.url === ZGLOSZENIE).map((z) => z.params.request);
  // Żądania pod ścieżkę /zgloszenie/ pod każdą nazwą serwera (także proba.invalid).
  const zgloszeniaWszedzie = () => zdarzenia.filter((z) => z.method === "Network.requestWillBeSent" && new URL(z.params.request.url).pathname === "/zgloszenie/").length;
  // Ciało żądania jako bajty: z wpisów zdarzenia albo, gdy ich nie ma, z Network.getRequestPostData.
  // null, gdy przeglądarka nie poda ciała bez utraty bajtów.
  async function cialoZadania(z) {
    const wpisy = z.params.request.postDataEntries;
    if (wpisy?.length && wpisy.every((w) => typeof w.bytes === "string")) return Buffer.concat(wpisy.map((w) => Buffer.from(w.bytes, "base64")));
    try {
      const w = await strona("Network.getRequestPostData", { requestId: z.params.requestId });
      return w.base64Encoded ? Buffer.from(w.postData, "base64") : null;
    } catch {
      return null;
    }
  }
  const stan6 = () => js(`(() => { const widac = (s) => { const e = document.querySelector(s); return Boolean(e) && !e.hidden && e.getClientRects().length > 0; };
    const k = document.querySelector('#wysylka-komunikat'); const b = document.querySelector('#wyslij');
    return { wysylka: widac('#widok-wysylka'), formularz: widac('#wysylka-formularz'), zapasowa: widac('#widok-zapasowa'), wyslane: widac('#widok-wyslane'),
      niedostepna: widac('#wysylka-niedostepna') && document.querySelector('#wysylka-niedostepna').textContent,
      adresBlad: widac('#adres-blad') && document.querySelector('#adres-blad').textContent, komunikat: widac('#wysylka-komunikat') && k.textContent,
      przycisk: b.textContent, aktywny: !b.disabled, wroc: widac('#zapasowa-wroc'), pokazZapasowa: widac('#zapasowa-pokaz'),
      wstecz: widac('#kreator-wstecz'), wsteczAktywny: !document.querySelector('#kreator-wstecz').disabled, dalej: widac('#kreator-dalej'),
      przyciski: widac('#kreator-przyciski'), tytul: widac('#wysylka-tytul'), adres: document.querySelector('#p-adres').value,
      fokus: document.activeElement?.id ?? '', zapisz: !document.querySelector('#zapisz').disabled }; })()`);
  async function wyslijZAdresem(adres, ms = 800) {
    await wpisz("#p-adres", adres, "input");
    const przed = zgloszenia().length;
    await js("document.querySelector('#wyslij').click()");
    await czekaj(ms);
    return zgloszenia().length - przed;
  }

  // Zapisy liczone ze zdarzeń przeglądarki: plik o tej samej nazwie przeglądarka sterowana przez
  // DevTools nadpisuje, zamiast dopisać (1), więc liczba plików w katalogu nie rośnie.
  const zapisy = () => zdarzenia.filter((z) => z.method === "Browser.downloadWillBegin").length;
  const czekajNaZapis = async (przed, numer) => {
    const jest = () => readdirSync(join(PRACA, "pobrane")).includes(`prosumentlab_${numer}.zip`);
    for (let i = 0; i < 40 && !(zapisy() > przed && jest()); i++) await czekaj(250);
    // Plik pojawia się w katalogu, zanim przeglądarka skończy go pisać.
    await czekaj(300);
    return zapisy() - przed;
  };
  const numerStrony = async () => (await tekstEl("#numer")).match(/[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/)?.[0] ?? "";
  const D = "example.invalid";
  const SIEC = "Nie udało się wysłać zgłoszenia. Sprawdź połączenie z internetem i spróbuj jeszcze raz albo zapisz plik i wyślij go sam.";
  const SERWER = "Nie udało się przyjąć zgłoszenia. Spróbuj za kilka minut albo zapisz plik i wyślij go sam.";
  const LIMIT = "Z tego urządzenia albo na ten adres wysłano już dziś kilka zgłoszeń. Spróbuj później albo zapisz plik i wyślij go sam.";
  const ZA_DUZY = "To zgłoszenie jest za duże, żeby wysłać je przez stronę. Zapisz plik i wyślij go sam.";
  const ADRES_BLAD = `Wpisz adres e-mail w postaci nazwa${"@"}domena.pl.`;

  // 1. Pusta strona (raz, 1280 px).
  await szerokosc(1280);
  await otworz();
  if (values["blad-probny"]) throw new Error("błąd próbny (--blad-probny)");
  sprawdz("tytuł strony", (await js("document.title")) === "Narzędzie do przygotowania pliku");
  sprawdz("teksty wstawione do wszystkich elementów", (await js("[...document.querySelectorAll('[data-tekst]')].filter(e => !e.textContent.trim()).length")) === 0);
  sprawdz("numer zgłoszenia w zdaniu", /^Numer Twojego zgłoszenia to [0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}\./.test(await tekstEl("#numer")));
  const czcionki = await js(`(() => { const p = document.querySelector('#numer'); const s = p.querySelector('.numer-zgloszenia');
    return { zdanie: getComputedStyle(p).fontFamily, numer: s && getComputedStyle(s).fontFamily, dzieci: p.querySelectorAll('*').length }; })()`);
  sprawdz("czcionką o stałej szerokości tylko numer", czcionki.dzieci === 1 && /Mono/.test(czcionki.numer) && !/Mono/.test(czcionki.zdanie), JSON.stringify(czcionki));
  sprawdz("powód w kroku 6: brak plików", (await tekstEl("#zapis-powod")) === "Najpierw wybierz plik godzinowy.");
  sprawdz("bez uwagi o brakujących polach na pustej stronie", await js("document.querySelector('#faktura-brak').hidden"));
  const odnosniki = await js("[...document.querySelectorAll('#plik-instrukcja a, #zgoda-wiecej a, #wersja a')].map(a => [a.getAttribute('href'), a.target, a.rel])");
  sprawdz("odnośniki instrukcji, zgody i repozytorium w nowej karcie", odnosniki.length === 3 && odnosniki.every(([, t, r]) => t === "_blank" && r === "noopener noreferrer"), JSON.stringify(odnosniki));
  sprawdz("krok 1: „jak go pobrać z eLicznika” prowadzi do /jak-pobrac-dane-z-elicznika/", await js(`(() => { const p = document.querySelector('#plik-instrukcja'); const a = p.querySelector('a');
    return p.previousElementSibling.dataset.tekst === 'pliki_wybor' && p.textContent === 'Nie masz jeszcze pliku? Zobacz, jak go pobrać z eLicznika.' && a.textContent === 'jak go pobrać z eLicznika' && a.getAttribute('href') === '/jak-pobrac-dane-z-elicznika/'; })()`));
  sprawdz("odnośnik zgody poza etykietą pola", await js("!document.querySelector('#zgoda-etykieta a') && document.querySelector('#zgoda-wiecej a').getAttribute('href') === '/prywatnosc/'"));
  sprawdz("zakres przed dodaniem pliku: zakres_pusty", (await tekstEl("#zakres")) === "Zakres pojawi się tu po dodaniu pliku.");
  sprawdz("stopka: tekst wersji 0.2.0 z numerem 0.1.5", (await tekstEl("#wersja")) === "To jest wersja 0.1.5. Kod tej wersji jest publiczny na GitHubie. Narzędzie wysyła tylko zgłoszenie i dopiero po wybraniu „Wyślij zgłoszenie”. Nie wysyła niczego do usług AI.");
  const panel = await js(`(() => { const d = document.querySelector('#krok-pliki details.panel');
    return { otwarty: d.open, napis: d.querySelector('summary').textContent, trafia: [...d.querySelectorAll('ul')][1].children.length, ostatni: [...d.querySelectorAll('ul')][1].lastElementChild.textContent }; })()`);
  sprawdz("krok 1: „Co zostaje u Ciebie, a co trafia do nas?” zwinięte, adres e-mail na liście „Trafia do nas”",
    !panel.otwarty && panel.napis === "Co zostaje u Ciebie, a co trafia do nas?" && panel.trafia === 5 && panel.ostatni === "adres e-mail, który wpiszesz w ostatnim kroku", JSON.stringify(panel));
  const listy = await js("[...document.querySelectorAll('[data-miesiac=\"magazyn_od\"] select')].map(s => s.options[0].textContent)");
  sprawdz("puste pozycje list: „miesiąc” i „rok”", JSON.stringify(listy) === JSON.stringify(["miesiąc", "rok"]), JSON.stringify(listy));
  const [rokTeraz, miesiacTeraz] = await js("(() => { const d = new Date(); return [String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0')]; })()");

  // Wybór miesiąca faktury z list; zdarzenie change jak przy wyborze z listy.
  const wybierzMiesiac = (m, r) => js(`(() => { const k = document.querySelector('[data-miesiac="okres_miesiac"]');
    k.querySelector('[data-czesc="miesiac"]').value = ${JSON.stringify(m)}; k.querySelector('[data-czesc="rok"]').value = ${JSON.stringify(r)};
    k.querySelector('select').dispatchEvent(new Event("change", { bubbles: true })); })()`);
  const wartosciMiesiaca = () => js("[...document.querySelectorAll('[data-miesiac=\"okres_miesiac\"] select')].map(s => s.value).join('/')");
  const fakturyWPodgladzie = () => js("document.querySelector('#podglad details[data-plik=\"faktury.json\"] pre')?.textContent ?? ''");

  // 2. Przejście przez sześć kroków, wysyłka z każdą odpowiedzią atrapy i droga zapasowa. Ta sama
  // próba na zwykłym ekranie (1280 px) i na telefonie (390 px z ekranem dotykowym).
  const probaKreatora = async (wariant, px) => {
    const w = (opis) => `${wariant}: ${opis}`;
    biezacaSzerokosc = px;
    await szerokosc(px);
    await otworz();
    const numer = await numerStrony();

    // Krok 1.
    let st = await stanKreatora();
    sprawdz(w("start: widoczny tylko krok 1, napis „Krok 1 z 6”, jeden odcinek paska, bez „Wstecz”, z „Dalej”"),
      st.krok === 1 && st.widoczne === 1 && st.napis === "Krok 1 z 6" && st.pasek === 1 && st.pasekUkryty && !st.wstecz && st.dalej, JSON.stringify(st));
    sprawdz(w("przyciski kreatora nie są przyklejone do ekranu"), !st.przyklejony);
    sprawdz(w("krok 1: tytuł, wstęp i akapit o operatorze"), (await tekstEl("#krok-pliki h1")) === "Plik z eLicznika" &&
      (await tekstEl('[data-tekst="wstep_opis"]')).startsWith("Narzędzie przygotowuje z Twojego pliku nowy plik") && (await widoczny('[data-tekst="wstep_operator"]')));
    sprawdz(w("przed dodaniem pliku bez pytania przy opuszczaniu strony"), !(await pytaPrzedWyjsciem()));
    await dalej();
    st = await stanKreatora();
    sprawdz(w("„Dalej” bez pliku: krok 1 zostaje, kreator_pliki_brak, fokus na komunikacie"),
      st.krok === 1 && st.komunikat === "Dodaj plik z eLicznika, żeby przejść dalej." && st.fokus === "komunikat", JSON.stringify(st));
    await ustawPliki([plikRok, plikStyczen, plikArkusz]);
    st = await stanKreatora();
    sprawdz(w("po dodaniu pliku komunikat kreatora znika"), st.komunikat === false, JSON.stringify(st));
    const plakietki = await js("[...document.querySelectorAll('.plakietka')].map(e => e.textContent)");
    sprawdz(w("plakietki plików"), JSON.stringify(plakietki) === JSON.stringify(["Przyjęty", "Przyjęty", "Odrzucony"]), plakietki.join(", "));
    sprawdz(w("plik_przyjety w nowym brzmieniu przy przyjętym pliku"), (await js("document.querySelectorAll('.plik')[0].textContent")).includes("Narzędzie odczytało plik. Do zgłoszenia trafi jego kopia bez numeru punktu poboru i numeru płatnika. Twój oryginalny plik zostaje bez zmian i nie jest wysyłany."));
    sprawdz(w("komunikat przy pliku arkusza"), (await js("document.querySelectorAll('.plik')[2].textContent")).includes("plik arkusza kalkulacyjnego"));
    const zakres = await tekstEl("#zakres");
    sprawdz(w("zakres w kroku 1: 13 miesięcy, jedna kropka po „r.”"), zakres.includes("Dane obejmują 13 pełnych miesięcy z rzędu, od stycznia 2025 r. do stycznia 2026 r. To wystarczy do pełnego raportu.") && !zakres.includes(".."), zakres.slice(0, 110));
    sprawdz(w("wczytane pliki: strona pyta przed opuszczeniem"), await pytaPrzedWyjsciem());
    sprawdz(w(`krok 1, ${px} px: bez poziomego przewijania`), await bezPrzewijaniaWPoziomie(px));
    await zrzut(`${wariant}-1-plik`);
    await js("window.scrollTo(0, 100000)");
    await dalej();
    st = await stanKreatora();
    sprawdz(w("„Dalej” z plikiem: krok 2 z 6, dwa odcinki paska, „Wstecz” widoczne, przewinięcie na górę, fokus na tytule kroku"),
      st.krok === 2 && st.widoczne === 1 && st.napis === "Krok 2 z 6" && st.pasek === 2 && st.wstecz && st.dalej && st.przewiniecie === 0 && st.fokusNaglowek, JSON.stringify(st));

    // Krok 2: faktura.
    const faktura = await js(`(() => ({
      tytul: document.querySelector('#krok-faktura h1').textContent,
      wstep: document.querySelector('#krok-faktura [data-tekst="faktura_wstep"]').textContent,
      zwiniete: [...document.querySelectorAll('#krok-faktura details')].every(d => !d.open),
      pierwsze: document.querySelector('#krok-faktura [data-pole]').dataset.pole,
      numery: [...document.querySelectorAll('.nr')].every(n => n.getAttribute('aria-hidden') === 'true'),
      sprzedawcy: [...document.querySelectorAll('[name="sprzedawca"]')].map(e => e.value).join(","),
      rysunek: document.querySelector('#krok-faktura details.rysunek-pokaz > summary').textContent,
    }))()`);
    sprawdz(w("krok 2: tytuł „Faktura”, wstęp, rozwijane części zwinięte, system rozliczenia jako pierwsze pole"),
      faktura.tytul === "Faktura" && faktura.wstep.startsWith("Przepisz dane z najnowszej faktury") && faktura.zwiniete && faktura.pierwsze === "system_rozliczenia", JSON.stringify(faktura));
    sprawdz(w("krok 2: rysunek faktury rozwijany, napis faktura_rysunek_pokaz"), faktura.rysunek === "Pokaż rysunek faktury z numerami pól", faktura.rysunek);
    sprawdz(w("numery pól ukryte przed czytnikiem ekranu, Pstryk przed „inny”"), faktura.numery && faktura.sprzedawcy.endsWith("pstryk,inny"), faktura.sprzedawcy);
    await js("document.querySelector('#krok-faktura details.rysunek-pokaz > summary').click()");
    await czekaj(500);
    const rysunek = await js(`(() => { const [a, b] = document.querySelectorAll('.rysunek-strony img'); const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return { zaladowane: a.naturalWidth > 0 && b.naturalWidth > 0, obok: Math.abs(ra.top - rb.top) < 1 && rb.left > ra.right, podSoba: rb.top >= ra.bottom, szerokosc: ra.width,
        opis: document.querySelector('#rysunek-faktury').getAttribute('aria-label') }; })()`);
    sprawdz(w("rysunek po rozwinięciu: obie strony załadowane, opis dla czytnika ekranu"), rysunek.zaladowane && rysunek.opis?.startsWith("Schemat dwóch stron faktury"), JSON.stringify(rysunek));
    if (px >= 600) sprawdz(w("rysunek: strony obok siebie"), rysunek.obok, `szerokość strony ${rysunek.szerokosc.toFixed(0)} px`);
    else {
      sprawdz(w("rysunek: strony jedna pod drugą"), rysunek.podSoba);
      const srednica = (18 * rysunek.szerokosc) / 262;
      sprawdz(w("rysunek: kółko z numerem co najmniej 20 px"), srednica >= 20, `${srednica.toFixed(1)} px`);
    }
    await js("document.querySelector('#krok-faktura details.rysunek-pokaz > summary').click()");
    await js("document.querySelector('#krok-faktura details.pomoc summary').click()");
    sprawdz(w("„Co to znaczy?” rozwija się kliknięciem"), (await js("document.querySelector('#krok-faktura details.pomoc').open")) && (await js("document.querySelector('#krok-faktura details.pomoc p').getBoundingClientRect().height")) > 0);
    await js("document.querySelector('#krok-faktura details.pomoc summary').click()");
    const okres = await js(`(() => {
      const widac = (e) => Boolean(e) && !e.hidden && e.getClientRects().length > 0;
      const [m, r] = document.querySelectorAll('[data-miesiac="okres_miesiac"] select');
      return { legenda: document.querySelector('[data-pole="okres_miesiac"] legend').textContent, widoczny: widac(m) && widac(r), daty: widac(document.querySelector('#okres-daty')),
        puste: m.value === '' && r.value === '', miesiace: [...m.options].map(o => o.textContent), lata: [...r.options].map(o => o.value) };
    })()`);
    const lataOczekiwane = [""];
    for (let r = Number(rokTeraz); r >= 2022; r--) lataOczekiwane.push(String(r));
    sprawdz(w("faktura: domyślnie miesiąc z dwóch pustych list, bez pól dat, lata od bieżącego do 2022"),
      okres.legenda === "2Miesiąc, za który jest faktura" && okres.widoczny && !okres.daty && okres.puste && okres.miesiace[1] === "styczeń" &&
      JSON.stringify(okres.lata) === JSON.stringify(lataOczekiwane), JSON.stringify(okres));
    sprawdz(w(`krok 2, ${px} px: bez poziomego przewijania`), await bezPrzewijaniaWPoziomie(px));
    await zrzut(`${wariant}-2-faktura`);

    // Brak danych obowiązkowych nie zatrzymuje: krok 3 z uwagą pod ostatnim polem.
    await dalej();
    st = await stanKreatora();
    const brak = await js(`(() => { const u = document.querySelector('#faktura-brak'); return { widac: !u.hidden && u.getClientRects().length > 0, tekst: u.textContent,
      ostatni: document.querySelector('#krok-cena').lastElementChild === u }; })()`);
    sprawdz(w("„Dalej” bez danych z faktury: przejście do kroku 3, bez komunikatu kreatora"), st.krok === 3 && st.komunikat === false && st.fokusNaglowek, JSON.stringify(st));
    sprawdz(w("krok 3: uwaga faktura_brak_obowiazkowych pod ostatnim polem kroku"),
      brak.widac && brak.ostatni && brak.tekst.startsWith("Bez tych danych nie przygotujemy raportu: sposób wyceny energii oddanej, sprzedawca,"), JSON.stringify(brak));
    await wstecz();
    st = await stanKreatora();
    sprawdz(w("„Wstecz” z kroku 3: krok 2, fokus na tytule"), st.krok === 2 && st.fokusNaglowek && st.napis === "Krok 2 z 6", JSON.stringify(st));

    // Błąd w polu zatrzymuje: miesiąc bieżący.
    await wybierzMiesiac(miesiacTeraz, rokTeraz);
    await czekaj(300);
    await dalej();
    st = await stanKreatora();
    const fokusMiesiaca = await js("document.activeElement === document.querySelector('[data-miesiac=\"okres_miesiac\"] [data-czesc=\"miesiac\"]')");
    sprawdz(w("miesiąc bieżący i „Dalej”: krok 2 zostaje, kreator_popraw z nazwą pola, fokus na liście miesiąca"),
      st.krok === 2 && st.komunikat === "Popraw zaznaczone pole, aby przejść dalej: miesiąc faktury." && fokusMiesiaca, JSON.stringify(st));
    sprawdz(w("przy polu błąd faktura_miesiac_biezacy"), (await tekstEl('[data-pole="okres_miesiac"] > .blad')) === "Faktury za ten miesiąc jeszcze nie ma. Wybierz miesiąc, który już się skończył.");
    sprawdz(w("komunikat kreatora pod tytułem kroku"), await js("document.querySelector('#krok-faktura h1').nextElementSibling.classList.contains('kreator-komunikat')"));
    await zrzut(`${wariant}-2a-faktura-blad`);
    await wybierzMiesiac("01", "2026");
    await czekaj(300);
    sprawdz(w("po poprawie pola komunikat kreatora znika"), (await stanKreatora()).komunikat === false);
    await js(`(() => {
      document.querySelector('input[name="system_rozliczenia"][value="net_billing_rce"]').click();
      document.querySelector('input[name="sprzedawca"][value="tauron_sprzedaz"]').click();
    })()`);
    await czekaj(300);
    await dalej();

    // Krok 3: cena energii.
    st = await stanKreatora();
    sprawdz(w("krok 3 „Cena energii”"), st.krok === 3 && (await tekstEl("#krok-cena h1")) === "Cena energii", JSON.stringify(st));
    await js(`(() => {
      const klik = (s) => document.querySelector(s).click();
      const wpisz = (s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); };
      klik('input[name="rodzaj_ceny"][value="stala"]');
      klik('input[name="taryfa"][value="g13"]');
      wpisz('#p-cena-0', '0,60000'); wpisz('#p-cena-1', '0,70000'); wpisz('#p-cena-2', '0,40000');
      wpisz('#p-oplata_abonamentowa_zl_mies', '5,67'); wpisz('#p-oplata_stala_sieciowa_zl_mies', '8,9');
      wpisz('#p-oplata-0-nazwa', 'Opłata handlowa'); wpisz('#p-oplata-0-kwota', '9,99000');
    })()`);
    await czekaj(600);
    sprawdz(w("strefy G13 z nazwami z faktury"), JSON.stringify(await js("[...document.querySelectorAll('#cena-pola label')].map(e => e.textContent)")) === JSON.stringify(["szczyt przedpołudniowy", "szczyt popołudniowy", "pozostałe godziny doby"]));
    sprawdz(w("komplet pól: bez uwagi o brakujących polach"), await js("document.querySelector('#faktura-brak').hidden"));
    await wpisz("#p-oplata_mocowa_zl_mies", "12,341", "input");
    await js("document.querySelector('details.oplaty').open = false");
    await dalej();
    st = await stanKreatora();
    const oplaty = await js("({ otwarte: document.querySelector('details.oplaty').open, fokus: document.activeElement?.id })");
    sprawdz(w("„12,341” i „Dalej”: krok 3 zostaje, kreator_popraw „opłata mocowa”, opłaty rozwinięte, fokus na polu"),
      st.krok === 3 && st.komunikat === "Popraw zaznaczone pole, aby przejść dalej: opłata mocowa." && oplaty.otwarte && oplaty.fokus === "p-oplata_mocowa_zl_mies", `${JSON.stringify(st)} ${JSON.stringify(oplaty)}`);
    sprawdz(w("przy polu błąd formatu kwoty"), (await tekstEl('[data-pole="oplata_mocowa_zl_mies"] .blad')).includes("na przykład 12,34"));
    await wpisz("#p-oplata_mocowa_zl_mies", "12,34000");
    await czekaj(300);
    sprawdz(w(`krok 3, ${px} px: bez poziomego przewijania`), await bezPrzewijaniaWPoziomie(px));
    await zrzut(`${wariant}-3-cena`);
    await dalej();

    // Krok 4: dodatkowe dane.
    st = await stanKreatora();
    sprawdz(w("krok 4 „Dodatkowe dane” ze wstępem"), st.krok === 4 && (await tekstEl("#krok-dodatkowe h1")) === "Dodatkowe dane" &&
      (await tekstEl('[data-tekst="instalacja_wstep"]')) === "Te dane pomogą nam dokładniej opisać wyniki w raporcie. Jeśli nie chcesz ich podawać, przejdź dalej.", JSON.stringify(st));
    const opcjeZmian = await js("[...document.querySelectorAll('[data-zmiana] .opcja span')].map(s => s.textContent)");
    sprawdz(w("opcje zmian w nowym brzmieniu"), JSON.stringify(opcjeZmian) === JSON.stringify(["doszła pompa ciepła", "doszedł samochód elektryczny", "rozbudowa instalacji fotowoltaicznej"]), JSON.stringify(opcjeZmian));
    await js(`(() => {
      const wpisz = (s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); };
      wpisz('#p-moc_pv_kwp', '7,2');
      document.querySelector('input[name="magazyn"][value="tak"]').click();
      wpisz('#p-magazyn_pojemnosc_kwh', '10');
      const m = document.querySelector('[data-miesiac="magazyn_od"]');
      m.querySelector('[data-czesc="miesiac"]').value = '04'; m.querySelector('[data-czesc="rok"]').value = '2022';
      m.querySelector('select').dispatchEvent(new Event("change", { bubbles: true }));
      const z = document.querySelector('[data-zmiana="0"]');
      z.querySelector('input[type="checkbox"]').click();
      z.querySelector('[data-czesc="miesiac"]').value = '07'; z.querySelector('[data-czesc="rok"]').value = '2025';
      z.querySelector('select').dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await czekaj(600);
    const rozbudowaPrzed = await js("(() => { const s = document.querySelector('[data-rodzaj=\"rozbudowa_pv\"] .zmiana-szczegoly'); return !s.hidden; })()");
    await js("document.querySelector('[data-rodzaj=\"rozbudowa_pv\"] input[type=\"checkbox\"]').click()");
    await czekaj(300);
    const rozbudowa = await js(`(() => { const z = document.querySelector('[data-rodzaj="rozbudowa_pv"]'); const widac = (e) => Boolean(e) && !e.hidden && e.getClientRects().length > 0;
      return { szczegoly: widac(z.querySelector('.zmiana-szczegoly')), podpis: z.querySelector('.podpis')?.textContent, listy: z.querySelectorAll('.miesiac-rok select').length,
        etykieta: z.querySelector('label[for="p-moc_przed_kwp"]')?.textContent, pole: widac(z.querySelector('#p-moc_przed_kwp')), pomoc: z.querySelector('#moc-przed-pomoc')?.textContent,
        inne: document.querySelectorAll('[data-rodzaj="pompa_ciepla"] .podpis, [data-rodzaj="pompa_ciepla"] #p-moc_przed_kwp').length }; })()`);
    sprawdz(w("rozbudowa instalacji: szczegóły dopiero po zaznaczeniu; podpis miesiąca, pole mocy przed z podpowiedzią"),
      !rozbudowaPrzed && rozbudowa.szczegoly && rozbudowa.podpis === "Od kiedy działa większa instalacja" && rozbudowa.listy === 2 && rozbudowa.etykieta === "Moc przed rozbudową w kWp" &&
      rozbudowa.pole && rozbudowa.pomoc === "Wpisz, jeśli ją znasz. Musi być mniejsza niż obecna moc instalacji." && rozbudowa.inne === 0, JSON.stringify(rozbudowa));
    await js(`(() => { const z = document.querySelector('[data-rodzaj="rozbudowa_pv"]');
      z.querySelector('[data-czesc="miesiac"]').value = '05'; z.querySelector('[data-czesc="rok"]').value = '2025';
      z.querySelector('select').dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await wpisz("#p-moc_przed_kwp", "8", "input");
    await dalej();
    st = await stanKreatora();
    sprawdz(w("moc przed rozbudową większa niż obecna i „Dalej”: krok 4 zostaje, komunikat z nazwą pola „moc przed rozbudową”, fokus na polu"),
      st.krok === 4 && st.komunikat === "Popraw zaznaczone pole, aby przejść dalej: moc przed rozbudową." && st.fokus === "p-moc_przed_kwp", JSON.stringify(st));
    sprawdz(w("przy polu mocy przed: instalacja_moc_przed_za_duza"), (await tekstEl('[data-pole="moc_przed_kwp"] .blad')) === "Moc przed rozbudową musi być mniejsza niż obecna moc instalacji." &&
      (await js("document.querySelector('[data-rodzaj=\"rozbudowa_pv\"] > .blad').hidden")));
    await wpisz("#p-moc_przed_kwp", "3,7");
    await czekaj(300);
    sprawdz(w(`krok 4, ${px} px: bez poziomego przewijania`), await bezPrzewijaniaWPoziomie(px));
    await zrzut(`${wariant}-4-dodatkowe`);
    await dalej();
    sprawdz(w("po poprawie „Dalej” prowadzi do kroku 5"), (await krok()) === 5);

    // „Wstecz” bez utraty danych: kroki 4, 3 i 2 z wpisanymi wartościami, potem znów do kroku 5.
    await wstecz();
    const wartosci4 = await js("[document.querySelector('#p-moc_pv_kwp').value, document.querySelector('#p-moc_przed_kwp').value, document.querySelector('[data-rodzaj=\"rozbudowa_pv\"] input[type=\"checkbox\"]').checked]");
    await wstecz();
    const wartosci3 = await js("[...document.querySelectorAll('#cena-pola input')].map(e => e.value).concat(document.querySelector('#p-oplata_mocowa_zl_mies').value)");
    await wstecz();
    const wartosci2 = await js("[document.querySelector('input[name=\"sprzedawca\"]:checked')?.value, document.querySelector('input[name=\"system_rozliczenia\"]:checked')?.value]");
    sprawdz(w("„Wstecz” niczego nie kasuje: wartości w krokach 4, 3 i 2 zostają"),
      JSON.stringify(wartosci4) === JSON.stringify(["7,2", "3,7", true]) && JSON.stringify(wartosci3) === JSON.stringify(["0,60000", "0,70000", "0,40000", "12,34000"]) &&
      JSON.stringify(wartosci2) === JSON.stringify(["tauron_sprzedaz", "net_billing_rce"]) && (await wartosciMiesiaca()) === "01/2026",
      JSON.stringify([wartosci4, wartosci3, wartosci2]));
    sprawdz(w("„Wstecz” do kroku 1: pliki zostają"), (await naKrok(1)) && (await js("document.querySelectorAll('.plik').length")) === 3);
    sprawdz(w("z kroku 1 do kroku 5 bez zatrzymania"), await naKrok(5));

    // Krok 5: sprawdzenie i zgoda.
    await czekaj(500);
    st = await stanKreatora();
    const podglad = await js(`(() => {
      const pod = document.querySelector('#podglad');
      return { tytul: document.querySelector('#krok-sprawdzenie h1').textContent, podtytul: document.querySelector('#krok-sprawdzenie h2').textContent,
        akapity: [...pod.children].filter(e => e.tagName === 'P').map(p => p.textContent),
        lista: [...pod.querySelectorAll('.lista-zip > li > details.plik-zip > summary')].map(s => s.textContent),
        otwarte: pod.querySelectorAll('details[open]').length,
        rozmiar: (() => { const r = document.querySelector('#podglad-rozmiar'); return !r.hidden && r.getClientRects().length > 0 && r.textContent; })() };
    })()`);
    sprawdz(w("krok 5: tytuł „Sprawdzenie i zgoda”, „Pliki zgłoszenia”, wstęp o plikach przygotowanych przez narzędzie, stan zgody"),
      st.krok === 5 && podglad.tytul === "Sprawdzenie i zgoda" && podglad.podtytul === "Pliki zgłoszenia" &&
      JSON.stringify(podglad.akapity) === JSON.stringify(["Tak wyglądają pliki przygotowane przez narzędzie. Tylko one trafią do nas, a plik pobrany z eLicznika zostaje u Ciebie. Wybierz nazwę pliku, żeby zobaczyć, co jest w środku.", "Zgoda niezaznaczona"]), JSON.stringify(podglad));
    sprawdz(w("podgląd: lista plików w kolejności z ZIP-a, wszystkie zwinięte"), JSON.stringify(podglad.lista) === JSON.stringify([
      "zgloszenie.jsonopis zgłoszenia: wersja narzędzia, numer, zakres danych i uwagi",
      "faktury.jsonliczby i nazwy przepisane z faktury",
      "instalacja.jsonodpowiedzi o instalacji",
      "pomiary_1.csvdane godzinowe z pliku eLicznik_2025.csv, bez numeru punktu poboru i numeru płatnika",
      "pomiary_2.csvdane godzinowe z pliku eLicznik_styczen.csv, bez numeru punktu poboru i numeru płatnika",
    ]) && podglad.otwarte === 0, JSON.stringify(podglad.lista));
    sprawdz(w("podgląd: rozmiar zgłoszenia po kompresji w KB"), /^Rozmiar zgłoszenia: \d+ KB\.$/.test(podglad.rozmiar || ""), String(podglad.rozmiar));
    const zgodaBez = await js("(() => { const z = document.querySelector('.zgoda').nextElementSibling; return z?.dataset.tekst === 'zgoda_bez' && !z.hidden && z.getClientRects().length > 0 && z.textContent; })()");
    sprawdz(w("zgoda_bez pod polem zgody, numer pod spodem"), zgodaBez === "Darmowy raport przygotujemy także bez tej zgody: pomagasz nam samym plikiem i danymi z faktury, z którymi porównamy obliczenia. Bez zgody plik i liczby z faktury usuniemy najpóźniej 3 dni po wysłaniu raportu." &&
      (await widoczny("#numer")), String(zgodaBez));
    await klik("#p-zgoda");
    await czekaj(500);
    sprawdz(w("zgoda zmienia ZIP: podgląd „Zgoda zaznaczona”, rozmiar znów widoczny po kompresji"),
      (await tekstEl("#podglad")).includes("Zgoda zaznaczona") && /^Rozmiar zgłoszenia: \d+ KB\.$/.test(await tekstEl("#podglad-rozmiar")) && !(await js("document.querySelector('#podglad-rozmiar').hidden")));
    sprawdz(w(`krok 5, ${px} px: bez poziomego przewijania`), await bezPrzewijaniaWPoziomie(px));
    await zrzut(`${wariant}-5-sprawdzenie`);
    await dalej();

    // Krok 6: wysyłka.
    st = await stanKreatora();
    let s6 = await stan6();
    sprawdz(w("krok 6 z 6: pasek pełny, „Wstecz” bez „Dalej”, fokus na tytule „Wysyłka”"),
      st.krok === 6 && st.napis === "Krok 6 z 6" && st.pasek === 6 && st.wstecz && !st.dalej && st.fokusNaglowek && (await tekstEl("#wysylka-tytul")) === "Wysyłka", JSON.stringify(st));
    sprawdz(w("krok 6 na serwerze próbnym (127.0.0.1): pole adresu, przycisk aktywny, odnośnik do drogi zapasowej, bez wysylka_niedostepna"),
      s6.wysylka && s6.formularz && !s6.zapasowa && s6.niedostepna === false && s6.przycisk === "Wyślij zgłoszenie" && s6.aktywny && s6.pokazZapasowa, JSON.stringify(s6));
    const pole = await js("(() => { const p = document.querySelector('#p-adres'); return [p.type, p.autocomplete, p.inputMode, document.querySelector('label[for=\"p-adres\"]').textContent, document.querySelector('#adres-pomoc').textContent]; })()");
    sprawdz(w("pole adresu: type=email, autocomplete=email, inputmode=email, etykieta i podpowiedź"), JSON.stringify(pole) === JSON.stringify(["email", "email", "email", "Twój adres e-mail", "Na ten adres wyślemy potwierdzenie i raport. Sprawdź go dokładnie: bez poprawnego adresu nie odpiszemy."]), JSON.stringify(pole));
    sprawdz(w("ramka wysylka_co z numerem zgłoszenia czcionką o stałej szerokości"),
      (await tekstEl("#wysylka-co")) === `Do ProsumentLab trafią pliki przygotowane przez narzędzie (zgłoszenie ${numer}), bez numeru PPE i numeru płatnika, oraz Twój adres e-mail. Plik pobrany z eLicznika i faktura zostają u Ciebie.` &&
      (await js("document.querySelector('#wysylka-co .numer-zgloszenia')?.textContent")) === numer);
    sprawdz(w("odnośnik do drogi zapasowej: wysylka_zapasowa_pokaz"), (await tekstEl("#zapasowa-pokaz")) === "Wolę zapisać plik i wysłać go sam");
    sprawdz(w(`krok 6, ${px} px: bez poziomego przewijania`), await bezPrzewijaniaWPoziomie(px));
    await zrzut(`${wariant}-6-wysylka`);

    // Adres sprawdzany w narzędziu: zły adres daje tekst przy polu, bez żądania.
    for (const zly of ["", "jan", `jan@domena`, `jań@${D}`, `-jan@${D}`, `ja n@${D}`, `ja;n@${D}`, `a@b@${D}`]) {
      const wyslane = await wyslijZAdresem(zly, 300);
      s6 = await stan6();
      sprawdz(w(`adres ${JSON.stringify(zly)}: wysylka_adres_blad przy polu, fokus na polu, bez żądania`), wyslane === 0 && s6.adresBlad === ADRES_BLAD && s6.fokus === "p-adres" && s6.aktywny, JSON.stringify(s6));
    }
    await wpisz("#p-adres", `jan@${D}`, "input");
    sprawdz(w("poprawianie adresu chowa tekst przy polu"), (await stan6()).adresBlad === false);
    // Enter w polu adresu z poprawnym adresem: klawisz z protokołu DevTools, jak z klawiatury.
    await js("document.querySelector('#p-adres').focus()");
    const przedEnter = zgloszeniaWszedzie();
    for (const type of ["keyDown", "keyUp"]) {
      await strona("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === "keyDown" && { text: "\r" }) });
    }
    await czekaj(600);
    s6 = await stan6();
    sprawdz(w("Enter w polu adresu: bez żądania, widok wysyłki bez zmian, fokus w polu"),
      zgloszeniaWszedzie() === przedEnter && s6.wysylka && !s6.wyslane && s6.przycisk === "Wyślij zgłoszenie" && s6.aktywny && s6.fokus === "p-adres" && s6.adres === `jan@${D}`, JSON.stringify(s6));

    // Każda odpowiedź atrapy.
    let n = await wyslijZAdresem(`zly-adres@${D}`);
    s6 = await stan6();
    sprawdz(w("400 zly_adres: jedno żądanie, wysylka_adres_blad przy polu, przycisk znów aktywny"), n === 1 && s6.adresBlad === ADRES_BLAD && s6.komunikat === false && s6.aktywny && s6.przycisk === "Wyślij zgłoszenie", JSON.stringify(s6));
    for (const [lokalna, tekst, opis] of [["za-duze", ZA_DUZY, "413 za_duze: wysylka_za_duzy"], ["limit", LIMIT, "429 limit: wysylka_blad_limit"], ["niedostepne", SERWER, "503 niedostepne: wysylka_blad_serwera"]]) {
      n = await wyslijZAdresem(`${lokalna}@${D}`);
      s6 = await stan6();
      sprawdz(w(`${opis}, przycisk znów aktywny, droga zapasowa widoczna`), n === 1 && s6.komunikat === tekst && s6.adresBlad === false && s6.aktywny && s6.pokazZapasowa && !s6.wyslane, JSON.stringify(s6));
    }
    const ostatnie = zgloszenia().at(-1);
    const naglowki = Object.fromEntries(Object.entries(ostatnie?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    sprawdz(w("żądanie: POST pod /zgloszenie/, typ application/zip, X-Numer z numerem strony, X-Adres z adresem, z treścią"),
      ostatnie?.method === "POST" && naglowki["content-type"] === "application/zip" && naglowki["x-numer"] === numer && naglowki["x-adres"] === `niedostepne@${D}` && ostatnie?.hasPostData === true, JSON.stringify({ metoda: ostatnie?.method, naglowki }));
    await wpisz("#p-adres", `brak-odpowiedzi@${D}`, "input");
    const przedBrakiem = zgloszenia().length;
    await js("document.querySelector('#wyslij').click()");
    await czekaj(200);
    s6 = await stan6();
    sprawdz(w("w trakcie wysyłki: przycisk nieaktywny z napisem wysylka_trwa, „Wstecz” nieaktywne"), !s6.aktywny && s6.przycisk === "Wysyłanie…" && !s6.wsteczAktywny, JSON.stringify(s6));
    await czekaj(2600);
    s6 = await stan6();
    sprawdz(w("brak odpowiedzi do końca limitu czasu: wysylka_blad_sieci, przycisk znów aktywny"), zgloszenia().length - przedBrakiem === 1 && s6.komunikat === SIEC && s6.aktywny && s6.przycisk === "Wyślij zgłoszenie" && s6.wsteczAktywny, JSON.stringify(s6));
    sprawdz(w("po nieudanych wysyłkach strona dalej pyta przed opuszczeniem"), await pytaPrzedWyjsciem());

    n = await wyslijZAdresem(`bez-potwierdzenia@${D}`);
    s6 = await stan6();
    const wyslane = await js(`(() => ({ tytul: document.querySelector('#wyslane-tytul').textContent, numer: document.querySelector('#wyslane-numer').textContent,
      numerCzcionka: getComputedStyle(document.querySelector('#wyslane-numer')).fontFamily, potwierdzenie: document.querySelector('#wyslane-potwierdzenie').textContent,
      adres: document.querySelector('#wyslane-potwierdzenie strong')?.textContent, brak: document.querySelector('#wyslane-brak').textContent,
      przycisk: document.querySelector('#wyslane-brak button')?.textContent, pytanie: document.querySelector('[data-tekst="wyslane_pytanie"]').textContent,
      strona: (() => { const a = document.querySelector('#widok-wyslane a.przycisk'); return [a.textContent, a.getAttribute('href'), a.target, a.rel]; })(),
      fokus: document.activeElement?.id, napis: document.querySelector('#kreator-krok').textContent }))()`);
    sprawdz(w("200 bez potwierdzenia: ekran po wysłaniu z wyslane_bez_potwierdzenia i adresem, bez przycisków kreatora, fokus na tytule, nad paskiem „Gotowe”"),
      n === 1 && s6.wyslane && !s6.wysylka && !s6.tytul && !s6.przyciski && wyslane.tytul === "Zgłoszenie wysłane" && wyslane.fokus === "wyslane-tytul" && wyslane.napis === "Gotowe" &&
      wyslane.potwierdzenie === `Zgłoszenie do nas dotarło, ale nie udało się wysłać potwierdzenia na adres bez-potwierdzenia@${D}. Raport wyślemy na ten adres w ciągu 10 dni roboczych. Jeśli adres jest błędny, popraw go i wyślij zgłoszenie jeszcze raz.` &&
      wyslane.adres === `bez-potwierdzenia@${D}`, JSON.stringify({ s6, wyslane }));
    sprawdz(w("ekran po wysłaniu: numer dużym krojem o stałej szerokości, ramka z przyciskiem poprawy, pytanie, przycisk na stronę w nowej karcie"),
      wyslane.numer === numer && /Mono/.test(wyslane.numerCzcionka) && wyslane.brak === "Nie widzisz potwierdzenia po kilku minutach? Sprawdź folder ze spamem. Jeśli go tam nie ma, adres mógł być błędny: popraw go i wyślij zgłoszenie jeszcze raz. Liczy się ostatnie." &&
      wyslane.przycisk === "popraw go i wyślij zgłoszenie jeszcze raz" && wyslane.pytanie === "Masz pytanie? Napisz na raporty@prosumentlab.pl i podaj numer zgłoszenia." &&
      JSON.stringify(wyslane.strona) === JSON.stringify(["Przejdź na stronę ProsumentLab", "/", "_blank", "noopener noreferrer"]), JSON.stringify(wyslane));
    sprawdz(w("po udanej wysyłce strona nie pyta przed opuszczeniem"), !(await pytaPrzedWyjsciem()));
    sprawdz(w(`ekran po wysłaniu, ${px} px: bez poziomego przewijania`), await bezPrzewijaniaWPoziomie(px));
    await zrzut(`${wariant}-7-wyslane`);
    await js("document.querySelector('#wyslane-popraw').click()");
    await czekaj(300);
    s6 = await stan6();
    sprawdz(w("„popraw go i wyślij zgłoszenie jeszcze raz”: krok 6 z wpisanym adresem, fokus na polu, „Wstecz” widoczne, napis „Krok 6 z 6”"),
      s6.wysylka && s6.formularz && !s6.wyslane && s6.adres === `bez-potwierdzenia@${D}` && s6.fokus === "p-adres" && s6.wstecz && s6.przyciski && s6.aktywny && (await krok()) === 6 &&
      (await tekstEl("#kreator-krok")) === "Krok 6 z 6", JSON.stringify(s6));
    n = await wyslijZAdresem(`jan@${D}`);
    s6 = await stan6();
    sprawdz(w("200 z potwierdzeniem (każdy inny adres): wyslane_potwierdzenie z poprawionym adresem"), n === 1 && s6.wyslane &&
      (await tekstEl("#wyslane-potwierdzenie")) === `Potwierdzenie wysłaliśmy na adres jan@${D}. Na ten sam adres przyjdzie raport, w ciągu 10 dni roboczych.`, await tekstEl("#wyslane-potwierdzenie"));
    await js("document.querySelector('#wyslane-popraw').click()");
    await czekaj(300);

    // Droga zapasowa. Zmiana danych po wysłaniu: strona znów pyta przed opuszczeniem.
    await wstecz();
    await klik("#p-zgoda");
    await czekaj(500);
    sprawdz(w("zmiana danych po wysyłce: strona znów pyta przed opuszczeniem"), await pytaPrzedWyjsciem());
    await dalej();
    await czekaj(300);
    await klik("#zapasowa-pokaz");
    s6 = await stan6();
    const zapasowa = await js(`(() => { const m = document.querySelector('#mailto');
      return { tytul: document.querySelector('#zapasowa-tytul').textContent, kroki: [...document.querySelectorAll('#droga-zapis h3')].map(h => h.textContent),
        href: m.hasAttribute('href'), aria: m.getAttribute('aria-disabled'), wroc: document.querySelector('#zapasowa-wroc').textContent,
        gdzie: document.querySelector('[data-tekst="zapis_gdzie"]').textContent }; })()`);
    sprawdz(w("droga zapasowa: zapasowa_tytul, krok 1 zapis i krok 2 wiadomość, „Napisz nową wiadomość” nieaktywne, zapasowa_wroc; fokus na tytule"),
      s6.zapasowa && !s6.wysylka && s6.wroc && s6.zapisz && s6.fokus === "zapasowa-tytul" && zapasowa.tytul === "Zapisz plik i wyślij go sam" &&
      JSON.stringify(zapasowa.kroki) === JSON.stringify(["Krok 1. Zapisz plik na tym urządzeniu.", "Krok 2. Napisz wiadomość i dołącz zapisany plik."]) && !zapasowa.href && zapasowa.aria === "true" &&
      zapasowa.wroc === "Wróć do wysyłki przez stronę", JSON.stringify({ s6, zapasowa }));
    sprawdz(w("zapis_gdzie bez zdania o tym, że narzędzie niczego nie wysyła"), zapasowa.gdzie === "Plik zapisze się na tym urządzeniu: na komputerze zwykle w folderze Pobrane, na iPhonie w aplikacji Pliki (w Safari w folderze „Pobrane rzeczy”, w Chrome w folderze „Chrome”).");
    sprawdz(w(`droga zapasowa, ${px} px: bez poziomego przewijania`), await bezPrzewijaniaWPoziomie(px));
    await zrzut(`${wariant}-8-zapasowa`);
    let przed = zapisy();
    await js("document.querySelector('#zapisz').click()");
    const nowe = await czekajNaZapis(przed, numer);
    const sciezkaZip = join(PRACA, "pobrane", `prosumentlab_${numer}.zip`);
    sprawdz(w("ZIP zapisany pod nazwą z numerem, od razu po kliknięciu"), nowe === 1 && readdirSync(join(PRACA, "pobrane")).includes(`prosumentlab_${numer}.zip`));
    if (nowe === 1) {
      const bajty = readFileSync(sciezkaZip);
      const zawartosc = czytajZip(bajty);
      sprawdz(w("zawartość ZIP-a"), JSON.stringify(zawartosc.map((p) => p.nazwa)) === JSON.stringify(["zgloszenie.json", "faktury.json", "instalacja.json", "pomiary_1.csv", "pomiary_2.csv"]));
      sprawdz(w("ZIP skompresowany: metoda 8 w każdym pliku, pliki pomiarów wyraźnie mniejsze"),
        zawartosc.every((p) => p.metoda === 8) && zawartosc.filter((p) => p.nazwa.endsWith(".csv")).every((p) => p.skompresowany * 3 < p.rozmiar),
        JSON.stringify(zawartosc.map((p) => [p.nazwa, p.metoda, p.skompresowany, p.rozmiar])));
      sprawdz(w("rozmiar w podglądzie równy rozmiarowi zapisanego ZIP-a"), (await tekstEl("#podglad-rozmiar")) === `Rozmiar zgłoszenia: ${rozmiarDoWyswietlenia(bajty.length)}.`, `${await tekstEl("#podglad-rozmiar")} / ${bajty.length} B`);
      const z = JSON.parse(new TextDecoder().decode(zawartosc[0].bajty));
      sprawdz(w("zgloszenie.json: numer, zgoda niezaznaczona po drugiej zmianie, klasyfikacja, wersja 0.1.5"), z.numer === numer && z.zgoda_przypadek_testowy === false && z.zakres.klasyfikacja === "raport" && z.narzedzie === "0.1.5", JSON.stringify(z).slice(0, 200));
      const tekstZip = bajty.toString("latin1");
      sprawdz(w("w ZIP-ie nie ma numerów PPE ani płatnika ani nazw plików ani adresu e-mail"), !tekstZip.includes(PPE_FIKCYJNE[0]) && !tekstZip.includes(PLATNICY_FIKCYJNI[0]) && !tekstZip.includes("eLicznik") && !tekstZip.includes(D));
      const fak = JSON.parse(new TextDecoder().decode(zawartosc[1].bajty));
      sprawdz(w("faktury.json z miesiąca: okres_od i okres_do, opłata „12,34000” jako 12.34"), fak.raport.okres_od === "2026-01-01" && fak.raport.okres_do === "2026-01-31" && fak.raport.oplata_mocowa_zl_mies === "12.34", JSON.stringify(fak.raport));
      const inst = JSON.parse(new TextDecoder().decode(zawartosc[2].bajty));
      sprawdz(w("instalacja.json w wersji 2: magazyn, pompa ciepła i rozbudowa z mocą przed"),
        inst.wersja_formatu === 2 && inst.magazyn_od === "2022-04" && JSON.stringify(inst.zmiany) === JSON.stringify([{ rodzaj: "pompa_ciepla", miesiac: "2025-07" }, { rodzaj: "rozbudowa_pv", miesiac: "2025-05", moc_przed_kwp: "3.70" }]), JSON.stringify(inst));
    }
    const ZAPISANO = `Zapisano plik prosumentlab_${numer}.zip.`;
    const potwierdzenie = () => js(`(() => { const g = document.querySelector('#zapis-gotowe'), p = document.querySelector('#zapis-ponownie'), m = document.querySelector('#mailto');
      return { gotowe: !g.hidden && g.getClientRects().length > 0 && g.textContent, ponownie: !p.hidden && p.getClientRects().length > 0 && p.textContent,
        href: m.getAttribute('href') ?? '', aria: m.getAttribute('aria-disabled'), poZapisie: !document.querySelector('#po-zapisie').hidden }; })()`);
    let pz = await potwierdzenie();
    sprawdz(w("po zapisie: zapis_gotowe, „Napisz nową wiadomość” aktywne z mailto, komunikat po zapisie"),
      pz.gotowe === ZAPISANO && pz.ponownie === false && pz.href.startsWith("mailto:raporty@prosumentlab.pl?subject=Dane%20do%20darmowego%20raportu%2C%20zg%C5%82oszenie%20") &&
      pz.href.endsWith(`&body=${encodeURIComponent(`Pamiętaj o załączniku: plik prosumentlab_${numer}.zip. Bez niego nie przygotujemy raportu.`)}`) && pz.aria === null && pz.poZapisie, JSON.stringify(pz));
    sprawdz(w("po zapisie strona nie pyta przed opuszczeniem"), !(await pytaPrzedWyjsciem()));
    przed = zapisy();
    await js("document.querySelector('#zapisz').click()");
    await czekajNaZapis(przed, numer);
    pz = await potwierdzenie();
    sprawdz(w("drugi zapis tej samej treści: zapis_gotowe bez zapis_ponownie"), zapisy() === przed + 1 && pz.gotowe === ZAPISANO && pz.ponownie === false, JSON.stringify(pz));
    // Inna treść: zmiana zgody w kroku 5, powrót do kroku 6 (widok wysyłki), znów droga zapasowa.
    await wstecz();
    await klik("#p-zgoda");
    await czekaj(500);
    sprawdz(w("zmiana danych po zapisie: strona znów pyta przed opuszczeniem"), await pytaPrzedWyjsciem());
    await dalej();
    s6 = await stan6();
    sprawdz(w("powrót do kroku 6 otwiera widok wysyłki"), s6.wysylka && !s6.zapasowa, JSON.stringify(s6));
    await klik("#zapasowa-pokaz");
    pz = await potwierdzenie();
    sprawdz(w("po zmianie danych potwierdzenie zapisu schowane, wiadomość znów nieaktywna"), pz.gotowe === false && pz.href === "" && pz.aria === "true", JSON.stringify(pz));
    przed = zapisy();
    await js("document.querySelector('#zapisz').click()");
    await czekajNaZapis(przed, numer);
    pz = await potwierdzenie();
    sprawdz(w("zapis innej treści w tej samej wizycie: zapis_gotowe i zapis_ponownie"), zapisy() === przed + 1 && pz.gotowe === ZAPISANO &&
      pz.ponownie === "To nowsza wersja pliku. Wyślij tylko ją; jeśli przeglądarka dopisała do nazwy (1) albo (2), wybierz plik z najwyższym numerem.", JSON.stringify(pz));
    await klik("#zapasowa-wroc");
    s6 = await stan6();
    sprawdz(w("zapasowa_wroc: z powrotem widok wysyłki, fokus na tytule kroku"), s6.wysylka && !s6.zapasowa && s6.fokus === "wysylka-tytul", JSON.stringify(s6));
  };
  await probaKreatora("komputer", 1280);

  // Prawdziwe pytanie przeglądarki przed opuszczeniem strony: po zapisie (ostatnia czynność
  // próby) go nie ma, także po działaniu użytkownika na stronie.
  await strona("Runtime.evaluate", { expression: "document.querySelector('#p-adres').focus()", userGesture: true });
  sprawdz("komputer: po zapisie przejście na inną stronę bez pytania przeglądarki", (await otworz(ADRES_INNY)) === null);

  // 3. Wysyłka niedostępna: ta sama strona pod nazwą inną niż 127.0.0.1 i localhost.
  await ustawPliki([plikStyczen]);
  sprawdz("inna nazwa serwera: z kroku 1 do kroku 6", await naKrok(6));
  await czekaj(500);
  let s6 = await stan6();
  sprawdz("inna nazwa serwera: bez pola adresu i przycisku, wysylka_niedostepna, od razu droga zapasowa bez powrotu do wysyłki",
    s6.wysylka && !s6.formularz && !s6.pokazZapasowa && s6.zapasowa && !s6.wroc && s6.zapisz &&
    s6.niedostepna === "Wysyłka przez stronę działa tylko pod adresem prosumentlab.pl. Zapisz plik i wyślij go sam.", JSON.stringify(s6));
  await zrzut("komputer-9-niedostepna");
  // Funkcja wysyłki sama sprawdza, czy wysyłka jest dostępna: kliknięcie ukrytego, aktywnego
  // przycisku z poprawnym adresem nie wysyła żądania.
  await wpisz("#p-adres", `jan@${D}`, "input");
  const przedNiedostepna = zgloszeniaWszedzie();
  const ukrytyAktywny = await js("(() => { const b = document.querySelector('#wyslij'); return !b.disabled && b.getClientRects().length === 0; })()");
  await js("document.querySelector('#wyslij').click()");
  await czekaj(800);
  s6 = await stan6();
  sprawdz("inna nazwa serwera: kliknięcie ukrytego przycisku wysyłki z poprawnym adresem nie wysyła żądania",
    ukrytyAktywny && zgloszeniaWszedzie() === przedNiedostepna && !s6.wyslane && s6.zapasowa && s6.przycisk === "Wyślij zgłoszenie", JSON.stringify({ ukrytyAktywny, s6 }));
  // Wczytany plik, zgłoszenie niewysłane i niezapisane, działanie użytkownika na stronie:
  // przeglądarka pyta przed przejściem na inną stronę.
  await strona("Runtime.evaluate", { expression: "document.querySelector('#zapasowa-tytul').focus()", userGesture: true });
  sprawdz("niewysłane zgłoszenie: przejście na inną stronę z pytaniem przeglądarki (beforeunload)", (await otworz()) === "beforeunload");

  // 3b. Podwójne kliknięcie „Wyślij zgłoszenie” daje jedno żądanie; ciało wysłanego żądania to te
  // same bajty co plik zapisany z tych samych danych.
  await ustawPliki([plikStyczen]);
  sprawdz("wysyłka i zapis: z kroku 1 do kroku 6", await naKrok(6));
  await czekaj(500);
  const numer3b = await numerStrony();
  // Podwójne kliknięcie myszą z protokołu DevTools. Atrapa nie odpowiada, więc drugie kliknięcie
  // trafia w trakcie wysyłki; po limicie czasu (w próbie 2 s) przycisk jest znów aktywny.
  await wpisz("#p-adres", `brak-odpowiedzi@${D}`, "input");
  const [x3b, y3b] = await js("(() => { const b = document.querySelector('#wyslij'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()");
  const przedPodwojnym = zgloszenia().length;
  for (const clickCount of [1, 2]) {
    await strona("Input.dispatchMouseEvent", { type: "mousePressed", x: x3b, y: y3b, button: "left", clickCount });
    await strona("Input.dispatchMouseEvent", { type: "mouseReleased", x: x3b, y: y3b, button: "left", clickCount });
  }
  await czekaj(300);
  sprawdz("podwójne kliknięcie myszą „Wyślij zgłoszenie”: jedno żądanie, przycisk w trakcie nieaktywny",
    zgloszenia().length - przedPodwojnym === 1 && !(await stan6()).aktywny, String(zgloszenia().length - przedPodwojnym));
  await czekaj(2600);
  // Dwa kliknięcia w jednym zadaniu strony, odpowiedź 200.
  await wpisz("#p-adres", `jan@${D}`, "input");
  const przedDwoma = zgloszenia().length;
  await js("(() => { const b = document.querySelector('#wyslij'); b.click(); b.click(); })()");
  await czekaj(800);
  sprawdz("dwa kliknięcia „Wyślij zgłoszenie” jedno po drugim: jedno żądanie, ekran po wysłaniu",
    zgloszenia().length - przedDwoma === 1 && (await stan6()).wyslane, String(zgloszenia().length - przedDwoma));
  const zadania3b = zdarzenia.filter((z) => z.method === "Network.requestWillBeSent" && z.params.request.url === ZGLOSZENIE).slice(-2);
  const ciala3b = await Promise.all(zadania3b.map(cialoZadania));
  await js("document.querySelector('#wyslane-popraw').click()");
  await czekaj(300);
  await klik("#zapasowa-pokaz");
  const przedZapisem3b = zapisy();
  await js("document.querySelector('#zapisz').click()");
  if ((await czekajNaZapis(przedZapisem3b, numer3b)) === 1) {
    const zapisany = readFileSync(join(PRACA, "pobrane", `prosumentlab_${numer3b}.zip`));
    sprawdz("ciało obu wysłanych żądań to te same bajty co zapisany plik ZIP (te same dane)",
      ciala3b.length === 2 && ciala3b.every((c) => c !== null && Buffer.compare(c, zapisany) === 0),
      JSON.stringify({ zapisany: zapisany.length, ciala: ciala3b.map((c) => c?.length ?? null) }));
    sprawdz("zapisany plik ZIP po wysyłkach: zawartość z numerem strony", JSON.parse(new TextDecoder().decode(czytajZip(zapisany)[0].bajty)).numer === numer3b);
  } else sprawdz("ciało obu wysłanych żądań to te same bajty co zapisany plik ZIP (te same dane)", false, "brak pliku");

  // 4. ZIP ponad limit wysyłki: przeglądarka bez CompressionStream (metoda 0) i sześć plików
  // rocznych.
  const { identifier: bezKompresji } = await strona("Page.addScriptToEvaluateOnNewDocument", { source: "delete window.CompressionStream;" });
  await otworz();
  await ustawPliki(plikiSzesciuLat, 6000);
  sprawdz("sześć plików rocznych przyjętych", (await js("[...document.querySelectorAll('.plakietka')].filter(e => e.textContent === 'Przyjęty').length")) === 6);
  sprawdz("bez kompresji: do kroku 6", await naKrok(6));
  await czekaj(1500);
  s6 = await stan6();
  const rozmiarDuzy = await tekstEl("#podglad-rozmiar");
  sprawdz("ZIP ponad 5 MiB: przycisk wysyłki nieaktywny, wysylka_za_duzy, droga zapasowa widoczna",
    !s6.aktywny && s6.komunikat === ZA_DUZY && s6.pokazZapasowa && s6.zapisz && /^Rozmiar zgłoszenia: [5-9],\d MB\.$/.test(rozmiarDuzy), `${JSON.stringify(s6)} ${rozmiarDuzy}`);
  const numerDuzy = await numerStrony();
  await klik("#zapasowa-pokaz");
  const przedDuzym = zapisy();
  await js("document.querySelector('#zapisz').click()");
  if ((await czekajNaZapis(przedDuzym, numerDuzy)) === 1) {
    const duzy = czytajZip(readFileSync(join(PRACA, "pobrane", `prosumentlab_${numerDuzy}.zip`)));
    sprawdz("bez CompressionStream: ZIP z metodą 0, zapis działa", duzy.every((p) => p.metoda === 0) && duzy.length === 7, JSON.stringify(duzy.map((p) => [p.nazwa, p.metoda])));
  } else sprawdz("bez CompressionStream: ZIP z metodą 0, zapis działa", false, "brak pliku");
  await strona("Page.removeScriptToEvaluateOnNewDocument", { identifier: bezKompresji });

  // 4a. Kompresja, która nie powiedzie się w trakcie (strumień zgłasza błąd): ZIP metodą 0,
  // wysyłka i zapis działają.
  const { identifier: zlaKompresja } = await strona("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.CompressionStream = class { constructor(f) { if (f !== "deflate-raw") throw new TypeError("format");
      const t = new TransformStream({ transform(_, k) { k.error(new Error("próba: zepsuta kompresja")); } }); this.readable = t.readable; this.writable = t.writable; } }; })()` });
  await otworz();
  await ustawPliki([plikStyczen]);
  sprawdz("nieudana kompresja: do kroku 6", await naKrok(6));
  await czekaj(800);
  s6 = await stan6();
  sprawdz("nieudana kompresja: przycisk wysyłki i zapis aktywne, bez komunikatu, rozmiar w podglądzie",
    s6.aktywny && s6.zapisz && s6.komunikat === false && (await zapisMozliwy()) && /^Rozmiar zgłoszenia: /.test(await tekstEl("#podglad-rozmiar")), JSON.stringify(s6));
  const numerZlej = await numerStrony();
  await klik("#zapasowa-pokaz");
  const przedZla = zapisy();
  await js("document.querySelector('#zapisz').click()");
  if ((await czekajNaZapis(przedZla, numerZlej)) === 1) {
    const zla = czytajZip(readFileSync(join(PRACA, "pobrane", `prosumentlab_${numerZlej}.zip`)));
    sprawdz("nieudana kompresja: zapisany ZIP metodą 0 w każdym pliku", zla.length >= 2 && zla.every((p) => p.metoda === 0), JSON.stringify(zla.map((p) => [p.nazwa, p.metoda])));
  } else sprawdz("nieudana kompresja: zapisany ZIP metodą 0 w każdym pliku", false, "brak pliku");
  await strona("Page.removeScriptToEvaluateOnNewDocument", { identifier: zlaKompresja });

  // 4b. Budowa ZIP-a nie udaje się żadną metodą (zapis nagłówków zgłasza błąd): krok 6 pokazuje
  // blad_nieznany, przyciski nieaktywne; kolejne wejście na krok ponawia próbę.
  await otworz();
  await ustawPliki([plikStyczen]);
  sprawdz("nieudana budowa ZIP-a: do kroku 4", await naKrok(4));
  await js("(() => { window.__probaSetUint32 = DataView.prototype.setUint32; DataView.prototype.setUint32 = function () { throw new Error('próba: zepsuta budowa ZIP-a'); }; })()");
  await dalej();
  await czekaj(500);
  await dalej();
  await czekaj(800);
  s6 = await stan6();
  const NIEZNANY = "Narzędzie nie odczytało tego pliku. Wybierz plik CSV pobrany z eLicznika.";
  sprawdz("nieudana budowa ZIP-a: krok 6 z blad_nieznany, wysyłka i zapis nieaktywne, bez rozmiaru",
    (await krok()) === 6 && (await tekstEl("#zapis-powod")) === NIEZNANY && (await widoczny("#zapis-powod")) && !s6.aktywny && !s6.zapisz &&
    (await js("document.querySelector('#podglad-rozmiar').hidden")), JSON.stringify({ powod: await tekstEl("#zapis-powod"), s6 }));
  await js("DataView.prototype.setUint32 = window.__probaSetUint32");
  await wstecz();
  await czekaj(500);
  await dalej();
  await czekaj(800);
  s6 = await stan6();
  sprawdz("nieudana budowa ZIP-a: po powrocie na krok próba od nowa, ZIP gotowy, bez komunikatu",
    (await krok()) === 6 && (await tekstEl("#zapis-powod")) === "" && s6.aktywny && s6.zapisz, JSON.stringify({ powod: await tekstEl("#zapis-powod"), s6 }));

  // 5. Formularz na zwykłym ekranie: system opustów, cena dynamiczna, korekta, okres, magazyn.
  await szerokosc(1280);
  biezacaSzerokosc = 1280;
  await otworz();
  await ustawPliki([plikRok, plikStyczen]);
  await naKrok(2);
  await js(`(() => {
    const klik = (s) => document.querySelector(s).click();
    const wpisz = (s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); };
    klik('input[name="system_rozliczenia"][value="net_billing_rce"]');
    klik('input[name="sprzedawca"][value="tauron_sprzedaz"]');
    klik('input[name="rodzaj_ceny"][value="stala"]');
    klik('input[name="taryfa"][value="g13"]');
    wpisz('#p-cena-0', '0,60000'); wpisz('#p-cena-1', '0,70000'); wpisz('#p-cena-2', '0,40000');
    wpisz('#p-oplata_mocowa_zl_mies', '12,34');
    wpisz('#p-moc_pv_kwp', '7,2');
    klik('input[name="magazyn"][value="tak"]');
    wpisz('#p-magazyn_pojemnosc_kwh', '10');
  })()`);
  await wybierzMiesiac("01", "2026");
  await czekaj(600);
  sprawdz("formularz: komplet pól, zapis możliwy", (await zapisMozliwy()) && (await js("document.querySelector('#faktura-brak').hidden")));
  await wpisz('[data-miesiac="magazyn_od"] [data-czesc="miesiac"]', "04");
  await czekaj(300);
  sprawdz("magazyn: sam miesiąc bez roku daje komunikat i blokuje zapis", (await tekstEl('[data-pole="magazyn_od"] .blad')) === "Wybierz miesiąc i rok albo zostaw oba pola puste." &&
    !(await zapisMozliwy()) && (await tekstEl("#zapis-powod")).includes("od kiedy działa magazyn"));
  await wpisz('[data-miesiac="magazyn_od"] [data-czesc="rok"]', "2022");
  await czekaj(300);
  const pojemnosc = () => js(`(() => { const u = document.querySelector('#pojemnosc-brak');
    return { widac: !u.hidden, tekst: u.textContent, klasa: u.className, pod: u.previousElementSibling?.id }; })()`);
  await wpisz("#p-magazyn_pojemnosc_kwh", "", "input");
  await czekaj(400);
  let poj = await pojemnosc();
  sprawdz("magazyn „tak” bez pojemności: uwaga instalacja_pojemnosc_brak pod polem, zapis możliwy",
    poj.widac && poj.klasa === "uwaga" && poj.pod === "p-magazyn_pojemnosc_kwh" && (await zapisMozliwy()) &&
    poj.tekst === "Jeśli znasz pojemność magazynu, wpisz ją. Bez niej opiszemy wyniki mniej dokładnie.", JSON.stringify(poj));
  await klik('input[name="magazyn"][value="nie"]');
  sprawdz("magazyn „nie”: bez uwagi o pojemności", !(await pojemnosc()).widac);
  await klik('input[name="magazyn"][value="tak"]');
  await wpisz("#p-magazyn_pojemnosc_kwh", "10", "input");
  await czekaj(400);
  poj = await pojemnosc();
  sprawdz("po wpisaniu pojemności uwaga znika", !poj.widac && (await zapisMozliwy()), JSON.stringify(poj));

  await klik('input[name="system_rozliczenia"][value="opusty"]');
  let podgladTeraz = await fakturyWPodgladzie();
  sprawdz("opusty: pozostałe pola faktury schowane, tekst o opustach widoczny w kroku 2",
    !(await widoczny("#faktura-pola")) && !(await widoczny('[data-miesiac="okres_miesiac"] select')) && (await tekstEl('[data-pole="system_rozliczenia"] .uwaga')).startsWith("Raportu dla systemu opustów jeszcze nie mamy"));
  sprawdz("opusty: w podglądzie faktury.json tylko operator i system, bez wcześniej wpisanych pól",
    podgladTeraz.includes('"operator_dystrybucyjny": "tauron_dystrybucja",\n    "system_rozliczenia": "opusty"\n  }') &&
    !podgladTeraz.includes('"sprzedawca"') && !podgladTeraz.includes('"oplata_mocowa_zl_mies"') && !podgladTeraz.includes("2026-01-01"), podgladTeraz);
  sprawdz("opusty: bez uwagi o brakujących polach, zapis możliwy", (await js("document.querySelector('#faktura-brak').hidden")) && (await zapisMozliwy()));
  await dalej();
  sprawdz("opusty: krok 3 bez pól, z tekstem o opustach", (await krok()) === 3 && !(await widoczny("#cena-kontener")) &&
    (await js("(() => { const u = document.querySelector('#krok-cena > [data-tekst=\"faktura_opusty\"]'); return !u.hidden && u.getClientRects().length > 0 && u.textContent.startsWith('Raportu dla systemu opustów'); })()")));
  await wstecz();
  await klik('input[name="system_rozliczenia"][value="net_billing_rce"]');
  podgladTeraz = await fakturyWPodgladzie();
  sprawdz("po powrocie z opustów wpisane wartości wracają na stronę i do podglądu",
    (await widoczny('[data-miesiac="okres_miesiac"] select')) && (await wartosciMiesiaca()) === "01/2026" &&
    podgladTeraz.includes('"okres_od": "2026-01-01"') && podgladTeraz.includes('"sprzedawca": "tauron_sprzedaz"') && podgladTeraz.includes('"oplata_mocowa_zl_mies": "12.34"'));

  await naKrok(3);
  await klik('input[name="rodzaj_ceny"][value="dynamiczna"]');
  const dyn = await js(`(() => ({
    tryb: document.querySelector('#cena-tryb').hidden,
    pola: document.querySelectorAll('#cena-pola input').length,
    etykieta: [...document.querySelectorAll('[data-pole="cena_energii_netto_zl_kwh"] legend span:not(.nr)')].filter(s => !s.hidden).map(s => s.textContent).join("|"),
    aria: document.querySelector('#p-cena')?.getAttribute('aria-label'),
  }))()`);
  sprawdz("cena dynamiczna: jedno pole, bez wyboru stref, własna etykieta",
    dyn.tryb && dyn.pola === 1 && dyn.etykieta === "Średnia cena energii z faktury, netto, zł/kWh" && dyn.aria === dyn.etykieta, JSON.stringify(dyn));
  await wpisz("#p-cena", "2,10", "input");
  await czekaj(500);
  sprawdz("cena dynamiczna 2,10: uwaga o nietypowej cenie, zapis możliwy",
    (await widoczny("#faktura-cena-nietypowa")) && (await zapisMozliwy()) && (await tekstEl("#podglad")).includes('"cena_energii_netto_zl_kwh": "2.10"'));
  await klik('input[name="rodzaj_ceny"][value="stala"]');
  sprawdz("powrót do ceny stałej: ceny w strefach wracają", JSON.stringify(await js("[...document.querySelectorAll('#cena-pola input')].map(e => e.value)")) === JSON.stringify(["0,60000", "0,70000", "0,40000"]) && !(await widoczny("#faktura-cena-nietypowa")));

  await naKrok(2);
  await klik("#p-korekta");
  sprawdz("korekta: pole wyboru, podpowiedź i „korekta” w faktury.json", (await widoczny("#korekta-podpowiedz")) && (await tekstEl("#podglad")).includes('"rodzaj_faktury": "korekta"'));
  await klik("#p-korekta");
  const bladMiesiaca = () => tekstEl('[data-pole="okres_miesiac"] > .blad');
  await wybierzMiesiac("02", "");
  await czekaj(300);
  sprawdz("sam miesiąc bez roku: instalacja_miesiac_niepelny i blokada zapisu",
    (await bladMiesiaca()) === "Wybierz miesiąc i rok albo zostaw oba pola puste." && !(await zapisMozliwy()) &&
    (await tekstEl("#zapis-powod")) === "Zanim zapiszesz plik ZIP, popraw albo wyczyść te pola: miesiąc faktury.");
  await wybierzMiesiac("02", "2024");
  await czekaj(300);
  sprawdz("luty 2024: okres do 2024-02-29, bez błędu", (await fakturyWPodgladzie()).includes('"okres_od": "2024-02-01",\n    "okres_do": "2024-02-29",') && (await bladMiesiaca()) === "");
  await wybierzMiesiac("01", "2026");
  await czekaj(300);
  await klik("#p-okres-inny");
  sprawdz("„inny okres” po styczniu 2026: daty 2026-01-01 i 2026-01-31 zamiast list, okres w faktury.json ten sam",
    (await widoczny("#p-okres_od")) && (await widoczny("#p-okres_do")) && !(await widoczny('[data-pole="okres_miesiac"]')) &&
    (await js("document.querySelector('#p-okres_od').value + '/' + document.querySelector('#p-okres_do').value")) === "2026-01-01/2026-01-31" &&
    (await fakturyWPodgladzie()).includes('"okres_od": "2026-01-01",\n    "okres_do": "2026-01-31",'));
  await wpisz("#p-okres_do", "2099-12-31");
  await czekaj(300);
  sprawdz("okres z przyszłości: błąd przy polu i blokada zapisu",
    (await tekstEl('[data-pole="okres_do"] .blad')).startsWith("Koniec okresu jest późniejszy niż dzisiejsza data.") && !(await zapisMozliwy()));
  await dalej();
  sprawdz("okres z przyszłości i „Dalej”: krok 2 zostaje, komunikat z nazwą „koniec okresu”, fokus na polu daty",
    (await krok()) === 2 && (await stanKreatora()).komunikat === "Popraw zaznaczone pole, aby przejść dalej: koniec okresu." && (await js("document.activeElement?.id")) === "p-okres_do");
  await wpisz("#p-okres_do", "2026-01-31");
  await wpisz("#p-okres_od", "2025-10-01");
  await czekaj(300);
  sprawdz("okres dłuższy niż 62 dni: uwaga, zapis możliwy", (await widoczny("#faktura-okres-dlugi")) && (await zapisMozliwy()));
  await klik("#p-okres-inny");
  sprawdz("odznaczenie „inny okres” wraca do wybranego miesiąca, bez uwagi o długim okresie",
    (await widoczny('[data-pole="okres_miesiac"]')) && !(await widoczny("#okres-daty")) && (await wartosciMiesiaca()) === "01/2026" && !(await widoczny("#faktura-okres-dlugi")));
  await klik("#p-okres-inny");
  sprawdz("ponowne zaznaczenie: wpisane daty zostały", (await js("document.querySelector('#p-okres_od').value + '/' + document.querySelector('#p-okres_do').value")) === "2025-10-01/2026-01-31");
  await klik("#p-okres-inny");

  // 6. Blokada bezpiecznika w pliku: „Dalej” w kroku 1 zatrzymane komunikatem blokady.
  await naKrok(1);
  await ustawPliki([plikZly]);
  sprawdz("plik z PPE w kolumnie strefy odrzucony", (await js("document.querySelectorAll('.plik')[2].textContent")).includes("nadal jest coś, co wygląda na numer"));
  sprawdz("blokada zapisu", !(await zapisMozliwy()) && (await tekstEl("#zapis-powod")).startsWith("Narzędzie nie utworzy pliku ZIP"));
  await dalej();
  let st = await stanKreatora();
  sprawdz("blokada pliku i „Dalej”: krok 1 zostaje z dotychczasowym komunikatem blokady", st.krok === 1 && typeof st.komunikat === "string" && st.komunikat.includes("nadal jest coś, co wygląda na numer") && st.fokus === "komunikat", JSON.stringify(st));
  await js("document.querySelectorAll('.plik')[2].querySelector('button').click()");
  await czekaj(800);
  sprawdz("po usunięciu pliku zapis znów możliwy, komunikat kreatora znika", (await zapisMozliwy()) && (await stanKreatora()).komunikat === false);
  await ustawPliki([plikInnyPunkt]);
  await dalej();
  st = await stanKreatora();
  sprawdz("różne punkty poboru i „Dalej”: krok 1 zostaje z komunikatem blad_rozne_ppe", st.krok === 1 && st.komunikat === "Te pliki pochodzą z różnych punktów poboru. Do jednego zgłoszenia dodaj pliki tylko z jednego punktu.", JSON.stringify(st));

  // 6b. Lista plików, duplikat, pliki bez numerów, podpowiedzi i uwagi pól.
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
  sprawdz("po zmianie pola strona dalej działa (zapis możliwy)", await zapisMozliwy());

  await otworz();
  await ustawPliki([plikStyczen]);
  await js(`(() => { const z = document.querySelector('[data-zmiana="0"]'); z.querySelector('input[type="checkbox"]').click(); })()`);
  await wpisz('[data-zmiana="0"] [data-czesc="miesiac"]', "11");
  await wpisz('[data-zmiana="0"] [data-czesc="rok"]', "2024");
  await czekaj(300);
  const uwagaZmiany = await js(`(() => { const z = document.querySelector('[data-zmiana="0"]'); const u = z.querySelector('.uwaga'), b = z.querySelector(':scope > .blad');
    return { uwaga: !u.hidden && u.textContent, blad: !b.hidden, klasa: u.className }; })()`);
  sprawdz("miesiąc zmiany spoza zakresu: styl uwagi, bez błędu, zapis możliwy", typeof uwagaZmiany.uwaga === "string" && uwagaZmiany.uwaga.startsWith("Ten miesiąc nie mieści się") && !uwagaZmiany.blad && (await zapisMozliwy()), JSON.stringify(uwagaZmiany));
  await js(`document.querySelector('input[name="taryfa"][value="g12"]').click()`);
  await czekaj(300);
  sprawdz("G12: bez podpowiedzi o kolejności stref", await js("document.querySelector('#strefy-kolejnosc').hidden"));
  await js(`(() => { document.querySelector('input[name="taryfa"][value="inna"]').click(); document.querySelector('input[name="cena_tryb"][value="strefy"]').click(); })()`);
  await czekaj(300);
  sprawdz("taryfa inna, osobna cena w każdej strefie: podpowiedź o kolejności stref", !(await js("document.querySelector('#strefy-kolejnosc').hidden")));
  sprawdz("podpowiedź przy polu nazwy taryfy", (await js("[...document.querySelectorAll('[data-pole=\"taryfa_nazwa\"] .podpowiedz')].map(p => !p.hidden && p.textContent).join('')")).startsWith("Wpisz tylko nazwę z faktury"));
  await wpisz("#p-taryfa_nazwa", "Taryfa PPE", "input");
  await czekaj(600);
  const POLA = "W polach wpisanych ręcznie jest coś";
  sprawdz("słowo PPE w polu: komunikat w kroku 6 przy zapisie i wysyłce, nie pod listą plików",
    (await tekstEl("#zapis-powod")).startsWith(POLA) && !(await js("document.querySelector('#zapis-powod').hidden")) &&
    !(await tekstEl("#blokady")).includes(POLA) && !(await zapisMozliwy()));
  const BLOKADA_POL = "W polach wpisanych ręcznie jest coś, co wygląda na numer albo adres e-mail. Narzędzie nie utworzy pliku ZIP. Sprawdź te pola i popraw je.";
  const doKroku6 = await naKrok(6);
  st = await stanKreatora();
  sprawdz("słowo PPE w nazwie taryfy i „Dalej”: zatrzymanie w kroku 3, blad_bezpiecznik_formularz w komunikacie kroku, fokus na polu",
    !doKroku6 && st.krok === 3 && st.komunikat === BLOKADA_POL && st.fokus === "p-taryfa_nazwa", JSON.stringify(st));
  await ustawPliki([plikInnyPunkt]);
  sprawdz("blokada z plików i z pól naraz: pliki w #blokady, pola w kroku 6",
    (await tekstEl("#blokady")).includes("różnych punktów poboru") && !(await tekstEl("#blokady")).includes(POLA) &&
    (await tekstEl("#zapis-powod")).startsWith(POLA));
  await js("document.querySelectorAll('.plik')[1].querySelector('button').click()");
  await czekaj(800);
  await wpisz("#p-taryfa_nazwa", "Taryfa X", "input");
  await czekaj(600);
  sprawdz("po poprawie pola blokada znika, także komunikat kroku", !(await tekstEl("#zapis-powod")).includes(POLA) && (await zapisMozliwy()) && (await stanKreatora()).komunikat === false);
  // Pole w zwiniętych opłatach stałych, w drugim wierszu: „Dalej” rozwija opłaty i daje fokus nazwie.
  await js("document.querySelector('details.oplaty').open = false; document.querySelector('#dodaj-oplate').click();");
  await js(`(() => { const wpisz = (s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); };
    wpisz('#p-oplata-1-nazwa', 'Opłata PPE'); wpisz('#p-oplata-1-kwota', '1,00'); })()`);
  await czekaj(600);
  await dalej();
  st = await stanKreatora();
  sprawdz("słowo PPE w nazwie opłaty w drugim wierszu i „Dalej”: krok 3 zostaje, opłaty rozwinięte, fokus na nazwie opłaty",
    st.krok === 3 && st.komunikat === BLOKADA_POL && st.fokus === "p-oplata-1-nazwa" && (await js("document.querySelector('details.oplaty').open")), JSON.stringify(st));
  await js(`(() => { const wpisz = (s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); };
    wpisz('#p-oplata-1-nazwa', ''); wpisz('#p-oplata-1-kwota', ''); })()`);
  await czekaj(600);
  sprawdz("po wyczyszczeniu nazwy opłaty blokada i komunikat kroku znikają", (await zapisMozliwy()) && (await stanKreatora()).komunikat === false);
  await ustawPliki([plikInnyPunkt]);
  sprawdz("sama blokada z plików: ogólny powód w kroku 6", (await tekstEl("#zapis-powod")) === "Narzędzie nie utworzy pliku ZIP, dopóki nie zniknie problem opisany wyżej.");

  // 6c. Zmiany z wersji 0.1.4, na świeżo otwartej stronie z plikiem stycznia. Wywoływane w obu
  // wariantach: zwykły ekran z kursorem i telefon z ekranem dotykowym.
  const proba014 = async (wariant, px) => {
    const w = (opis) => `${wariant}: ${opis}`;
    await otworz();
    await ustawPliki([plikStyczen]);
    await naKrok(2);
    const pola2 = await js("[...document.querySelectorAll('#krok-faktura [data-pole]')].map(e => e.dataset.pole)");
    const pola3 = await js("[...document.querySelectorAll('#krok-cena [data-pole]')].map(e => e.dataset.pole)");
    sprawdz(w("kolejność pytań: krok 2 (system, sprzedawca, miesiąc, korekta), krok 3 (rodzaj ceny, taryfa, cena, opłaty)"),
      JSON.stringify(pola2) === JSON.stringify(["system_rozliczenia", "sprzedawca", "sprzedawca_nazwa", "okres_miesiac", "okres_od", "okres_do", "rodzaj_faktury"]) &&
      JSON.stringify(pola3) === JSON.stringify(["rodzaj_ceny", "taryfa", "taryfa_nazwa", "cena_energii_netto_zl_kwh", "oplata_mocowa_zl_mies", "oplata_abonamentowa_zl_mies", "oplata_stala_sieciowa_zl_mies", "oplata_przejsciowa_zl_mies", "oplaty_stale_inne"]),
      JSON.stringify([pola2, pola3]));

    // Sprzedawca z listy wpisany jako „inny” (krok 2).
    await klik('input[name="sprzedawca"][value="inny"]');
    const naLiscie = () => js(`(() => { const u = document.querySelector('#sprzedawca-na-liscie'); return !u.hidden && u.getClientRects().length > 0 && u.className === 'uwaga' && u.textContent; })()`);
    await wpisz("#p-sprzedawca_nazwa", "Tauron Sprzedaż", "input");
    await czekaj(500);
    sprawdz(w("„inny” + „Tauron Sprzedaż”: uwaga sprzedawca_na_liscie pod polem, zapis możliwy"),
      (await naLiscie()) === "Ten sprzedawca jest na liście powyżej. Możesz go tam wybrać albo zostawić swój wpis." && (await zapisMozliwy()) &&
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

    // Opusty chowają pola w krokach 2 i 3.
    await klik('input[name="system_rozliczenia"][value="opusty"]');
    sprawdz(w("opusty: pola kroku 2 schowane, tekst o opustach przy systemie rozliczenia"), !(await widoczny("#faktura-pola")) && (await widoczny('[data-pole="system_rozliczenia"] .uwaga')));
    await naKrok(3);
    sprawdz(w("opusty: krok 3 bez pól, z tekstem o opustach"), !(await widoczny("#cena-kontener")) && (await widoczny('#krok-cena > [data-tekst="faktura_opusty"]')));
    await naKrok(2);
    await klik('input[name="system_rozliczenia"][value="net_billing_rce"]');
    await naKrok(3);

    // Zdanie pod grupą taryfową (krok 3).
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

    // Pstryk (krok 2) ustawia cenę dynamiczną; zmiana sprzedawcy niczego nie kasuje.
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

    // Cena wpisana jak przez klienta i wyjście z pola: „1” -> „1,00”, „51” -> błąd groszy (G11).
    await klik('input[name="taryfa"][value="g11"]');
    const wpiszCene = async (tekst) => {
      await js("(() => { const e = document.querySelector('#p-cena'); e.focus(); e.select(); })()");
      await strona("Input.insertText", { text: tekst });
      await js("document.querySelector('#p-cena').blur()");
      await czekaj(400);
    };
    await wpiszCene("1");
    sprawdz(w("cena „1” po wyjściu z pola: „1,00”, w faktury.json \"1.00\""),
      (await js("document.querySelector('#p-cena').value")) === "1,00" && (await tekstEl("#podglad")).includes('"cena_energii_netto_zl_kwh": "1.00"'), await js("document.querySelector('#p-cena').value"));
    await wpiszCene("51");
    const bladCeny = await tekstEl('[data-pole="cena_energii_netto_zl_kwh"] > .blad');
    sprawdz(w("cena „51”: błąd faktura_cena_grosze przy polu, wartość bez zmian, zapis zablokowany"),
      bladCeny === "Cena wygląda na podaną w groszach. Wpisz ją w złotych, na przykład 0,62." && (await js("document.querySelector('#p-cena').value")) === "51" &&
      !(await zapisMozliwy()) && (await tekstEl("#zapis-powod")).includes("cena energii"), bladCeny);
    await dalej();
    sprawdz(w("cena „51” i „Dalej”: krok 3 zostaje, fokus na polu ceny"), (await krok()) === 3 && (await js("document.activeElement?.id")) === "p-cena" &&
      (await stanKreatora()).komunikat === "Popraw zaznaczone pole, aby przejść dalej: cena energii.");
    await wpiszCene("0,62");
    sprawdz(w("cena „0,62”: bez błędu, zapis możliwy"), (await tekstEl('[data-pole="cena_energii_netto_zl_kwh"] > .blad')) === "" && (await zapisMozliwy()));

    // Dwa pliki o tych samych wartościach z różnym PPE: blokada, nie duplikat.
    await ustawPliki([plikStyczenInnyPpe]);
    const plakietki = await js("[...document.querySelectorAll('.plakietka')].map(e => e.textContent)");
    sprawdz(w("ten sam styczeń z innym PPE: oba pliki przyjęte, blad_rozne_ppe, zapis zablokowany, bez komunikatu o duplikacie"),
      JSON.stringify(plakietki) === JSON.stringify(["Przyjęty", "Przyjęty"]) && (await tekstEl("#blokady")).includes("Te pliki pochodzą z różnych punktów poboru.") &&
      !(await tekstEl("#lista-plikow")).includes("Taki sam plik") && !(await zapisMozliwy()), `${plakietki.join(", ")} | ${await tekstEl("#blokady")}`);
    await js("document.querySelectorAll('.plik')[1].querySelector('button').click()");
    await czekaj(800);
    sprawdz(w("po usunięciu pliku z innym PPE zapis znów możliwy"), await zapisMozliwy());

    // Zmiana pola tuż przed zapisem (w ciągu 250 ms): bez nieaktualnego potwierdzenia.
    await naKrok(6);
    await czekaj(500);
    await klik("#zapasowa-pokaz");
    const przed = zapisy();
    await js("document.querySelector('#zapisz').click()");
    for (let i = 0; i < 40 && zapisy() <= przed; i++) await czekaj(250);
    const stanZapisu = () => js(`(() => { const widac = (s) => { const e = document.querySelector(s); return !e.hidden && e.getClientRects().length > 0; };
      return { gotowe: widac('#zapis-gotowe'), poZapisie: widac('#po-zapisie'), href: document.querySelector('#mailto').hasAttribute('href') }; })()`);
    sprawdz(w("zapis: potwierdzenie i aktywna wiadomość"), zapisy() === przed + 1 && JSON.stringify(await stanZapisu()) === JSON.stringify({ gotowe: true, poZapisie: true, href: true }), JSON.stringify(await stanZapisu()));
    const tuzPo = await js(`(() => { const e = document.querySelector('#p-cena'); e.value = '51'; e.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#zapisz').click();
      const widac = (s) => { const x = document.querySelector(s); return !x.hidden && x.getClientRects().length > 0; };
      return { gotowe: widac('#zapis-gotowe'), poZapisie: widac('#po-zapisie'), href: document.querySelector('#mailto').hasAttribute('href'),
        zablokowany: document.querySelector('#zapisz').disabled }; })()`);
    await czekaj(1000);
    sprawdz(w("zła cena i kliknięcie zapisu przed przeliczeniem: bez potwierdzenia i komunikatu po zapisie, wiadomość bez href, bez nowego pliku"),
      !tuzPo.gotowe && !tuzPo.poZapisie && !tuzPo.href && tuzPo.zablokowany && zapisy() === przed + 1 && JSON.stringify(await stanZapisu()) === JSON.stringify({ gotowe: false, poZapisie: false, href: false }), JSON.stringify(tuzPo));
    await wpisz("#p-cena", "0,62");
    sprawdz(w(`${px} px: bez poziomego przewijania`), await bezPrzewijaniaWPoziomie(px));
  };

  // 6d. Zmiany z wersji 0.1.5 w obu wariantach.
  const proba015 = async (wariant, px) => {
    const w = (opis) => `${wariant}: ${opis}`;
    await otworz();
    await ustawPliki([plikStyczen]);
    const naglowek = await js(`(() => { const a = document.querySelector('header.naglowek a.marka');
      const akapity = [...document.querySelectorAll('#krok-pliki p.wstep, #krok-pliki p.drobny')].filter((p) => !p.hidden && p.getClientRects().length > 0);
      return { tekst: a?.textContent, href: a?.getAttribute('href'), target: a?.getAttribute('target'), rel: a?.getAttribute('rel'), widoczny: Boolean(a) && a.getClientRects().length > 0,
        akapity: akapity.map((p) => p.dataset.tekst), operator: akapity[1]?.textContent }; })()`);
    sprawdz(w("nagłówek: „ProsumentLab”, odnośnik do / w nowej karcie, rel noopener noreferrer"),
      naglowek.tekst === "ProsumentLab" && naglowek.href === "/" && naglowek.target === "_blank" && naglowek.rel === "noopener noreferrer" && naglowek.widoczny, JSON.stringify(naglowek));
    sprawdz(w("krok 1: akapit o operatorze widoczny pod opisem"),
      JSON.stringify(naglowek.akapity) === JSON.stringify(["wstep_opis", "wstep_operator"]) &&
      naglowek.operator === "Na razie narzędzie przyjmuje pliki z eLicznika Taurona. Nad plikami od innych operatorów pracujemy.", JSON.stringify(naglowek));

    await naKrok(3);
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
      (await bladCeny()) === "Wpisz wartość w każdej strefie albo wyczyść te pola." && !(await zapisMozliwy()), await bladCeny());
    await wpisz("#p-cena-1", "0,60", "input");
    await czekaj(500);
    sprawdz(w("G12, ta sama cena w obu polach: bez błędu, zapis możliwy, dwie ceny w faktury.json"),
      (await bladCeny()) === "" && (await zapisMozliwy()) && /"cena_energii_netto_zl_kwh": \[\s*"0\.60",\s*"0\.60"\s*\]/.test(await tekstEl("#podglad")), await bladCeny());
    await klik('input[name="rodzaj_ceny"][value="dynamiczna"]');
    sprawdz(w("G12 przy cenie dynamicznej: jedno pole, bez wyboru i podpowiedzi, pomoc z tabelą Taurona"),
      JSON.stringify(await stanCen()) === JSON.stringify({ wybor: false, podpowiedz: false, etykiety: ["Średnia cena energii z faktury, netto, zł/kWh"] }) &&
      (await pomoc())[0]?.startsWith("Przy cenie dynamicznej faktura podaje średnią cenę za 1 kWh"), `${JSON.stringify(await stanCen())} ${JSON.stringify(await pomoc())}`);
    await klik('input[name="rodzaj_ceny"][value="stala"]');
    await klik('input[name="taryfa"][value="g11"]');
    await wpisz("#p-cena", "1,80", "input");
    await czekaj(500);
    sprawdz(w("G11, cena 1,80: bez uwagi o nietypowej cenie"), !(await widoczny("#faktura-cena-nietypowa")) && (await tekstEl("#podglad")).includes('"cena_energii_netto_zl_kwh": "1.80"'));
    await wpisz("#p-cena", "2,10", "input");
    await czekaj(500);
    sprawdz(w("G11, cena 2,10: uwaga o nietypowej cenie, zapis możliwy"),
      (await widoczny("#faktura-cena-nietypowa")) && (await zapisMozliwy()) && (await tekstEl("#podglad")).includes('"cena_energii_netto_zl_kwh": "2.10"'));
    sprawdz(w(`${px} px: bez poziomego przewijania`), await bezPrzewijaniaWPoziomie(px));
  };
  await proba014("komputer", 1280);
  await proba015("komputer", 1280);

  // 7. Telefon: 390 px i ekran dotykowy z emulacji DevTools (pointer: coarse).
  await strona("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await szerokosc(390);
  await otworz();
  sprawdz("telefon: emulacja dotyku daje pointer: coarse", await js("matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches"));
  await probaKreatora("telefon", 390);
  await proba014("telefon", 390);
  await proba015("telefon", 390);
  await strona("Emulation.setTouchEmulationEnabled", { enabled: false });
  await szerokosc(1280);
  biezacaSzerokosc = 1280;

  // 8. Czas przeliczenia po zmianie jednego pola przy czterech plikach rocznych.
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

  // 9. Sieć, konsola, polityka treści, przechowywanie w przeglądarce.
  // Zdarzenia sieci pochodzą z karty ze stroną, więc sprawdzenie dotyczy zapytań strony. Ruch samej
  // przeglądarki jest poza nim; ten wyłączają flagi przy starcie.
  const zapytania = zdarzenia.filter((z) => z.method === "Network.requestWillBeSent").map((z) => ({ url: z.params.request.url, metoda: z.params.request.method }));
  // Jedyny dopuszczony adres data: to wbudowana ikona kalendarza pola daty w Chrome (obrazek SVG),
  // nie zapytanie strony. blob: to ZIP zapisywany przez stronę.
  const obce = zapytania.filter(({ url }) => !url.startsWith(ADRES) && !url.startsWith(ADRES_INNY) && !url.startsWith("blob:") && !url.startsWith("data:image/svg+xml"));
  sprawdz("karta: żadnych zapytań poza 127.0.0.1 (także pod nazwą proba.invalid)", obce.length === 0, obce.map((z) => z.url).join(", "));
  const wlasne = zapytania.filter(({ url }) => url.startsWith(ADRES) || url.startsWith(ADRES_INNY)).map(({ url, metoda }) => ({ sciezka: new URL(url).pathname, metoda }));
  const zle = wlasne.filter(({ sciezka, metoda }) => !(metoda === "GET" && /^\/(?:[A-Za-z0-9_\-/]+\.(?:js|css|svg|woff2|ico))?$/.test(sciezka)) && !(metoda === "POST" && sciezka === "/zgloszenie/"));
  sprawdz("karta: zapytania tylko o pliki strony i POST pod /zgloszenie/", zle.length === 0, JSON.stringify([...new Set(zle.map((z) => `${z.metoda} ${z.sciezka}`))]));
  sprawdz("karta: żądania pod /zgloszenie/ tylko metodą POST i tylko z kliknięcia wysyłki", zgloszenia().every((z) => z.method === "POST") && zgloszenia().length > 0, String(zgloszenia().length));
  const bledy = zdarzenia
    .filter((z) => z.method === "Runtime.exceptionThrown" ||
      (z.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(z.params.type)) ||
      (z.method === "Log.entryAdded" && ["error", "warning"].includes(z.params.entry.level)))
    // Czcionki lokalnie nie istnieją (są na stronie), favicon.ico też: 404 rozpoznajemy po adresie.
    // Odpowiedzi atrapy z kodem błędu (400, 413, 429, 503) i przerwane żądanie bez odpowiedzi
    // przeglądarka wpisuje do konsoli z adresem /zgloszenie/; to zamierzone przypadki próby.
    .filter((z) => !/favicon\.ico|\/czcionki\/|\/zgloszenie\/$/.test(z.params.entry?.url ?? ""))
    // Przejście próby na inną stronę bez działania użytkownika: przeglądarka nie pokazuje pytania
    // z beforeunload i odnotowuje to w konsoli (to potwierdza, że strona pytanie ustawiła).
    .filter((z) => !(z.params.entry?.text ?? "").startsWith("Blocked attempt to show a 'beforeunload' confirmation panel for a frame that never had a user gesture"))
    // Zamierzona nieudana budowa ZIP-a w próbie 4b: strona zapisuje błąd w konsoli.
    .filter((z) => !(z.method === "Runtime.consoleAPICalled" && JSON.stringify(z.params.args ?? []).includes("próba: zepsuta budowa ZIP-a")))
    // Pod nazwą proba.invalid po HTTP (jak serwer próbny w sieci domowej) przeglądarka pomija
    // nagłówek Cross-Origin-Opener-Policy, bo działa on tylko na stronie z HTTPS albo localhost.
    .filter((z) => !((z.params.entry?.url ?? "").startsWith(ADRES_INNY) && (z.params.entry?.text ?? "").startsWith("The Cross-Origin-Opener-Policy header has been ignored")))
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
