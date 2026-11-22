#!/usr/bin/env node
// Lokalny serwer plików do uruchomienia narzędzia (moduły ES nie działają z file://).
// - Domyślnie słucha tylko na 127.0.0.1, więc strona nie jest widoczna z sieci. Opcja --host
//   pozwala wystawić stronę w sieci domowej do odbioru na telefonie; wtedy serwer ostrzega.
// - Serwuje wyłącznie katalog app/; ścieżki wychodzące poza niego dają 404, także przez
//   dowiązanie: plik musi leżeć w app/ po rozwinięciu dowiązań.
// - Błąd odczytu pliku daje odpowiedź 500 i nie zatrzymuje serwera.
// - Wysyła te same nagłówki, których README wymaga od serwera podającego narzędzie: politykę
//   treści (z frame-ancestors, którego znacznik meta nie obejmuje), Cross-Origin-Opener-Policy,
//   X-Content-Type-Options i Referrer-Policy.
//
// - Z opcją --zgloszenie udaje skrypt przyjmujący zgłoszenia: POST /zgloszenie/ dostaje odpowiedź
//   w tej samej postaci co ze strony (JSON ze stanem, te same kody i nagłówki). Odpowiedź wybiera
//   część adresu przed „@” w nagłówku X-Adres (ODPOWIEDZI_ATRAPY), więc próba w przeglądarce
//   sprawdza każdą odpowiedź bez restartu serwera, wpisując inny adres. Atrapa nie zapisuje
//   niczego na dysku, nie wypisuje treści żądania ani adresu i niczego nie wysyła; ciało żądania
//   odczytuje tylko po to, żeby policzyć bajty, i przestaje czytać po przekroczeniu limitu
//   z zapasem (413 i zamknięcie połączenia). Odpowiedź „brak odpowiedzi” zamyka połączenie po
//   150 s, dłużej niż limit czasu wysyłki w narzędziu (120 s). Bez opcji ścieżka /zgloszenie/
//   daje 404.
//
// Użycie: node narzedzia/serwer.mjs [--port 8000] [--host 127.0.0.1] [--zgloszenie]
// --port 0 oznacza port wybrany przez system; wartość spoza 0–65535 albo nie liczba to błąd.

import { createServer } from "node:http";
import { readFile, stat, realpath } from "node:fs/promises";
import { join, normalize, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const APP = fileURLToPath(new URL("../app/", import.meta.url));

export const POLITYKA = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  // Żądania tylko do tej samej domeny: wysyłka zgłoszenia pod /zgloszenie/.
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const TYPY = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

async function plikDla(adres, katalog) {
  let sciezka;
  try {
    sciezka = decodeURIComponent(new URL(adres, "http://127.0.0.1").pathname);
  } catch {
    return null;
  }
  if (sciezka.includes("\0")) return null;
  if (sciezka.endsWith("/")) sciezka += "index.html";
  const pelna = normalize(join(katalog, sciezka));
  if (!pelna.startsWith(katalog) || pelna.slice(katalog.length).split(sep).includes("..")) return null;
  try {
    // Dowiązanie może prowadzić poza katalog: liczy się ścieżka po rozwinięciu dowiązań.
    const [prawdziwa, korzen] = await Promise.all([realpath(pelna), realpath(katalog)]);
    if (!prawdziwa.startsWith(korzen + sep)) return null;
    return (await stat(prawdziwa)).isFile() ? prawdziwa : null;
  } catch {
    return null;
  }
}

// --- Atrapa przyjmowania zgłoszeń ------------------------------------------------------------

export const SCIEZKA_ZGLOSZENIA = "/zgloszenie/";
const LIMIT_ZGLOSZENIA = 5 * 1024 * 1024; // jak na stronie: ZIP najwyżej 5 MiB
// Ciało do 64 KiB ponad limit atrapa czyta do końca i odpowiada 413 po odczycie; przy większym
// przestaje czytać od razu, odpowiada 413 i zamyka połączenie.
const ZAPAS_ODCZYTU = 64 * 1024;
// Połączenie bez odpowiedzi zamykane po 150 s: dłużej niż limit czasu wysyłki w narzędziu (120 s),
// więc narzędzie samo przerywa czekanie, a atrapa nie trzyma połączeń bez końca.
export const CZAS_BRAKU_ODPOWIEDZI_MS = 150 * 1000;
const NUMER = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

// Część adresu przed „@” -> odpowiedź. Każdy inny adres: 200 z potwierdzeniem.
// `null` jako kod: brak odpowiedzi, połączenie wisi (jak przy zerwanej sieci albo zawieszonym
// serwerze), aż klient je zamknie albo minie CZAS_BRAKU_ODPOWIEDZI_MS.
export const ODPOWIEDZI_ATRAPY = {
  "przyjete": { kod: 200, potwierdzenie: true },
  "bez-potwierdzenia": { kod: 200, potwierdzenie: false },
  "zly-adres": { kod: 400, stan: "zly_adres" },
  "za-duze": { kod: 413, stan: "za_duze" },
  "limit": { kod: 429, stan: "limit" },
  "niedostepne": { kod: 503, stan: "niedostepne" },
  "brak-odpowiedzi": { kod: null },
};
const RETRY_AFTER_S = "60";

function odpowiedzJson(odpowiedz, naglowki, kod, tresc, dodatkowe = {}) {
  odpowiedz.writeHead(kod, { ...naglowki, ...dodatkowe, "Content-Type": "application/json; charset=utf-8" });
  odpowiedz.end(JSON.stringify(tresc));
}

// Kolejność sprawdzeń jak w skrypcie na stronie, w zakresie, który ma sens lokalnie: metoda (405),
// typ treści (415), rozmiar (413), numer (400), potem odpowiedź wybrana adresem. Origin, limity
// i budowy ZIP-a atrapa nie sprawdza.
function atrapaZgloszenia(zadanie, odpowiedz, naglowki, { czasBrakuOdpowiedziMs }) {
  if (zadanie.method !== "POST") {
    zadanie.resume();
    odpowiedz.writeHead(405, { ...naglowki, Allow: "POST" }).end();
    return;
  }
  let bajty = 0;
  const liczBajty = (czesc) => {
    bajty += czesc.length;
    if (bajty <= LIMIT_ZGLOSZENIA + ZAPAS_ODCZYTU) return;
    // Za dużo: bez czytania reszty. Po wysłaniu odpowiedzi połączenie jest zamykane, bo nieodczytane
    // ciało zostałoby w nim.
    zadanie.off("data", liczBajty);
    zadanie.off("end", poOdczycie);
    zadanie.pause();
    odpowiedz.on("finish", () => zadanie.socket?.destroy());
    odpowiedzJson(odpowiedz, naglowki, 413, { stan: "za_duze" }, { Connection: "close" });
  };
  const poOdczycie = () => {
    const typ = (zadanie.headers["content-type"] ?? "").trim().toLowerCase();
    if (typ !== "application/zip") return odpowiedzJson(odpowiedz, naglowki, 415, { stan: "zly_typ" });
    if (bajty > LIMIT_ZGLOSZENIA) return odpowiedzJson(odpowiedz, naglowki, 413, { stan: "za_duze" });
    const numer = zadanie.headers["x-numer"] ?? "";
    if (!NUMER.test(numer)) return odpowiedzJson(odpowiedz, naglowki, 400, { stan: "zly_numer" });
    const adres = zadanie.headers["x-adres"] ?? "";
    const lokalna = adres.includes("@") ? adres.slice(0, adres.lastIndexOf("@")) : "";
    const wybor = Object.hasOwn(ODPOWIEDZI_ATRAPY, lokalna) ? ODPOWIEDZI_ATRAPY[lokalna] : ODPOWIEDZI_ATRAPY.przyjete;
    if (wybor.kod === null) {
      // Brak odpowiedzi: połączenie zostaje otwarte do zamknięcia przez klienta albo do upływu czasu.
      const zamknij = setTimeout(() => zadanie.socket?.destroy(), czasBrakuOdpowiedziMs);
      zamknij.unref();
      odpowiedz.on("close", () => clearTimeout(zamknij));
      return;
    }
    if (wybor.kod === 200) return odpowiedzJson(odpowiedz, naglowki, 200, { stan: "przyjete", numer, potwierdzenie: wybor.potwierdzenie });
    return odpowiedzJson(odpowiedz, naglowki, wybor.kod, { stan: wybor.stan }, wybor.kod === 429 ? { "Retry-After": RETRY_AFTER_S } : {});
  };
  zadanie.on("data", liczBajty);
  zadanie.on("end", poOdczycie);
}

// --- Serwer ----------------------------------------------------------------------------------

function sciezkaZadania(adres) {
  try {
    return new URL(adres, "http://127.0.0.1").pathname;
  } catch {
    return null;
  }
}

// `katalog`: katalog strony (domyślnie app/; testy podają tymczasowy). Separator na końcu jest
// dopisywany, gdy go brak, żeby porównanie początku ścieżki nie przepuściło katalogu obok
// o tym samym początku nazwy (app2 obok app). `zgloszenie`: włącza atrapę POST /zgloszenie/.
// `czasBrakuOdpowiedziMs`: po jakim czasie atrapa zamyka połączenie bez odpowiedzi (testy skracają).
export function utworzSerwer(katalog = APP, { zgloszenie = false, czasBrakuOdpowiedziMs = CZAS_BRAKU_ODPOWIEDZI_MS } = {}) {
  if (!katalog.endsWith(sep)) katalog += sep;
  return createServer(async (zadanie, odpowiedz) => {
    const naglowki = {
      "Content-Security-Policy": POLITYKA,
      "Cross-Origin-Opener-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    };
    if (sciezkaZadania(zadanie.url) === SCIEZKA_ZGLOSZENIA) {
      if (zgloszenie) {
        atrapaZgloszenia(zadanie, odpowiedz, naglowki, { czasBrakuOdpowiedziMs });
        return;
      }
      zadanie.resume();
      odpowiedz.writeHead(404, { ...naglowki, "Content-Type": "text/plain; charset=utf-8" }).end(zadanie.method === "HEAD" ? undefined : "404\n");
      return;
    }
    if (zadanie.method !== "GET" && zadanie.method !== "HEAD") {
      odpowiedz.writeHead(405, { ...naglowki, Allow: "GET, HEAD" }).end();
      return;
    }
    const plik = await plikDla(zadanie.url, katalog);
    if (!plik) {
      odpowiedz.writeHead(404, { ...naglowki, "Content-Type": "text/plain; charset=utf-8" }).end("404\n");
      return;
    }
    let tresc;
    try {
      tresc = await readFile(plik);
    } catch {
      odpowiedz.writeHead(500, { ...naglowki, "Content-Type": "text/plain; charset=utf-8" }).end("500\n");
      return;
    }
    // Długość treści także przy HEAD: odpowiedź bez ciała mówi, ile miałoby GET.
    odpowiedz.writeHead(200, { ...naglowki, "Content-Type": TYPY[extname(plik)] ?? "text/plain; charset=utf-8", "Content-Length": tresc.length });
    odpowiedz.end(zadanie.method === "HEAD" ? undefined : tresc);
  });
}

export const HOST_DOMYSLNY = "127.0.0.1";

export function komunikatStartu(host, port, { zgloszenie = false } = {}) {
  const atrapa = zgloszenie
    ? `Atrapa przyjmowania zgłoszeń: POST ${SCIEZKA_ZGLOSZENIA}. Odpowiedź wybiera część adresu e-mail przed „@”: ` +
      `${Object.keys(ODPOWIEDZI_ATRAPY).filter((k) => k !== "przyjete").join(", ")}; każdy inny adres daje przyjęcie z potwierdzeniem.\n`
    : "";
  const adres = `${atrapa}Narzędzie działa pod adresem http://${host}:${port}/ (Ctrl+C kończy).\n`;
  if (host === HOST_DOMYSLNY) return adres;
  return (
    `UWAGA: serwer słucha na adresie ${host}, więc strona jest widoczna w sieci lokalnej.\n` +
    "Używaj tylko plików z generatora (narzedzia/generator.mjs), nigdy prawdziwych plików z licznika.\n" +
    "Po odbiorze zatrzymaj serwer.\n" +
    adres
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        port: { type: "string", default: "8000" },
        host: { type: "string", default: HOST_DOMYSLNY },
        zgloszenie: { type: "boolean", default: false },
      },
    }));
  } catch (blad) {
    process.stderr.write(`serwer: ${blad.message}\n`);
    process.exit(2);
  }
  if (!/^\d{1,5}$/.test(values.port) || +values.port > 65535) {
    process.stderr.write("serwer: --port: oczekiwana liczba od 0 do 65535 (0 to port wybrany przez system)\n");
    process.exit(2);
  }
  const port = +values.port;
  const serwer = utworzSerwer(APP, { zgloszenie: values.zgloszenie });
  serwer.on("error", (blad) => {
    process.stderr.write(`serwer: ${blad.message}\n`);
    process.exit(2);
  });
  serwer.listen(port, values.host, () => {
    process.stdout.write(komunikatStartu(values.host, serwer.address().port, { zgloszenie: values.zgloszenie }));
  });
}
