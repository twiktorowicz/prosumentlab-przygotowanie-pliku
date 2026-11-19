#!/usr/bin/env node
// Lokalny serwer plików do uruchomienia narzędzia (moduły ES nie działają z file://).
// - Słucha tylko na 127.0.0.1, więc strona nie jest widoczna z sieci.
// - Serwuje wyłącznie katalog app/; ścieżki wychodzące poza niego dają 404.
// - Wysyła tę samą politykę treści co strona, żeby lokalnie było widać jej naruszenia.
//
// Użycie: node narzedzia/serwer.mjs [--port 8000]

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
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

async function plikDla(adres) {
  let sciezka;
  try {
    sciezka = decodeURIComponent(new URL(adres, "http://127.0.0.1").pathname);
  } catch {
    return null;
  }
  if (sciezka.includes("\0")) return null;
  if (sciezka.endsWith("/")) sciezka += "index.html";
  const pelna = normalize(join(APP, sciezka));
  if (!pelna.startsWith(APP) || pelna.slice(APP.length).split(sep).includes("..")) return null;
  try {
    return (await stat(pelna)).isFile() ? pelna : null;
  } catch {
    return null;
  }
}

export function utworzSerwer() {
  return createServer(async (zadanie, odpowiedz) => {
    const naglowki = {
      "Content-Security-Policy": POLITYKA,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    };
    if (zadanie.method !== "GET" && zadanie.method !== "HEAD") {
      odpowiedz.writeHead(405, { ...naglowki, Allow: "GET, HEAD" }).end();
      return;
    }
    const plik = await plikDla(zadanie.url);
    if (!plik) {
      odpowiedz.writeHead(404, { ...naglowki, "Content-Type": "text/plain; charset=utf-8" }).end("404\n");
      return;
    }
    const tresc = await readFile(plik);
    odpowiedz.writeHead(200, { ...naglowki, "Content-Type": TYPY[extname(plik)] ?? "text/plain; charset=utf-8" });
    odpowiedz.end(zadanie.method === "HEAD" ? undefined : tresc);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({ options: { port: { type: "string", default: "8000" } } });
  const port = /^\d{1,5}$/.test(values.port) ? +values.port : 8000;
  utworzSerwer().listen(port, "127.0.0.1", () => {
    process.stdout.write(`Narzędzie działa pod adresem http://127.0.0.1:${port}/ (Ctrl+C kończy).\n`);
  });
}
