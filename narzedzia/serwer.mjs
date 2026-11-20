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
// Użycie: node narzedzia/serwer.mjs [--port 8000] [--host 127.0.0.1]
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
  "connect-src 'none'",
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

// `katalog`: katalog strony (domyślnie app/; testy podają tymczasowy). Separator na końcu jest
// dopisywany, gdy go brak, żeby porównanie początku ścieżki nie przepuściło katalogu obok
// o tym samym początku nazwy (app2 obok app).
export function utworzSerwer(katalog = APP) {
  if (!katalog.endsWith(sep)) katalog += sep;
  return createServer(async (zadanie, odpowiedz) => {
    const naglowki = {
      "Content-Security-Policy": POLITYKA,
      "Cross-Origin-Opener-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    };
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

export function komunikatStartu(host, port) {
  const adres = `Narzędzie działa pod adresem http://${host}:${port}/ (Ctrl+C kończy).\n`;
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
      options: { port: { type: "string", default: "8000" }, host: { type: "string", default: HOST_DOMYSLNY } },
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
  const serwer = utworzSerwer();
  serwer.on("error", (blad) => {
    process.stderr.write(`serwer: ${blad.message}\n`);
    process.exit(2);
  });
  serwer.listen(port, values.host, () => {
    process.stdout.write(komunikatStartu(values.host, serwer.address().port));
  });
}
