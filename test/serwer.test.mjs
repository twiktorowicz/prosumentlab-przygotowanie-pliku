// Lokalny serwer plików (narzedzia/serwer.mjs): tylko katalog app/, tylko 127.0.0.1, ta sama
// polityka treści co na stronie.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { utworzSerwer, POLITYKA } from "../narzedzia/serwer.mjs";

let serwer;
let port;
before(async () => {
  serwer = utworzSerwer();
  await new Promise((gotowe) => serwer.listen(0, "127.0.0.1", gotowe));
  port = serwer.address().port;
});
after(() => new Promise((gotowe) => serwer.close(gotowe)));

// Zapytanie z dokładną ścieżką, bez normalizacji adresu (fetch usuwa „..” sam).
function zapytaj(sciezka, metoda = "GET") {
  return new Promise((wynik, blad) => {
    const z = request({ host: "127.0.0.1", port, path: sciezka, method: metoda }, (o) => {
      const czesci = [];
      o.on("data", (c) => czesci.push(c));
      o.on("end", () => wynik({ status: o.statusCode, naglowki: o.headers, tresc: Buffer.concat(czesci) }));
    });
    z.on("error", blad);
    z.end();
  });
}

test("strona główna z nagłówkami bezpieczeństwa", async () => {
  const o = await zapytaj("/");
  assert.equal(o.status, 200);
  assert.equal(o.naglowki["content-type"], "text/html; charset=utf-8");
  assert.equal(o.naglowki["content-security-policy"], POLITYKA);
  assert.match(POLITYKA, /connect-src 'none'/);
  assert.match(POLITYKA, /frame-ancestors 'none'/);
  assert.equal(o.naglowki["x-content-type-options"], "nosniff");
  assert.equal(o.naglowki["cache-control"], "no-store");
  assert.deepEqual(o.tresc, readFileSync(fileURLToPath(new URL("../app/index.html", import.meta.url))));
});

test("typy plików", async () => {
  const typy = {
    "/main.js": "text/javascript; charset=utf-8",
    "/lib/zip.js": "text/javascript; charset=utf-8",
    "/style.css": "text/css; charset=utf-8",
    "/faktura-strona-1.svg": "image/svg+xml",
    "/faktura-strona-2.svg": "image/svg+xml",
    "/teksty.js": "text/javascript; charset=utf-8",
  };
  for (const [sciezka, typ] of Object.entries(typy)) {
    const o = await zapytaj(sciezka);
    assert.equal(o.status, 200, sciezka);
    assert.equal(o.naglowki["content-type"], typ, sciezka);
  }
});

test("poza katalogiem app/ nic nie wychodzi", async () => {
  for (const sciezka of ["/../AGENTS.md", "/..%2fAGENTS.md", "/%2e%2e/AGENTS.md", "/lib/../../README.md", "/AGENTS.md", "/nie-ma.js", "/lib", "/%00"]) {
    const o = await zapytaj(sciezka);
    assert.ok(o.status === 404 || o.status === 400, `${sciezka}: ${o.status}`);
    assert.equal(o.tresc.includes("Zasady pracy"), false, sciezka);
  }
});

test("tylko GET i HEAD", async () => {
  assert.equal((await zapytaj("/", "POST")).status, 405);
  const head = await zapytaj("/", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.tresc.length, 0);
});

test("polityka w znaczniku meta strony jest ta sama, bez frame-ancestors", () => {
  const html = readFileSync(fileURLToPath(new URL("../app/index.html", import.meta.url)), "utf8");
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];
  assert.equal(meta, POLITYKA.replace("; frame-ancestors 'none'", ""));
});
