// Lokalny serwer plików (narzedzia/serwer.mjs): tylko katalog app/, tylko 127.0.0.1, ta sama
// polityka treści co na stronie.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, chmodSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { utworzSerwer, POLITYKA, komunikatStartu } from "../narzedzia/serwer.mjs";
import { spawn, spawnSync } from "node:child_process";

let serwer;
let port;
before(async () => {
  serwer = utworzSerwer();
  await new Promise((gotowe) => serwer.listen(0, "127.0.0.1", gotowe));
  port = serwer.address().port;
});
after(() => new Promise((gotowe) => serwer.close(gotowe)));

// Zapytanie z dokładną ścieżką, bez normalizacji adresu (fetch usuwa „..” sam).
function zapytaj(sciezka, metoda = "GET", naPorcie = port) {
  return new Promise((wynik, blad) => {
    const z = request({ host: "127.0.0.1", port: naPorcie, path: sciezka, method: metoda }, (o) => {
      const czesci = [];
      o.on("data", (c) => czesci.push(c));
      o.on("end", () => wynik({ status: o.statusCode, naglowki: o.headers, tresc: Buffer.concat(czesci) }));
    });
    z.on("error", blad);
    z.end();
  });
}

// Komplet nagłówków, które ma wysyłać każdy serwer podający narzędzie (README, „Nagłówki”).
const NAGLOWKI_WYMAGANE = {
  "content-security-policy": POLITYKA,
  "cross-origin-opener-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

test("strona główna z kompletem czterech nagłówków bezpieczeństwa", async () => {
  const o = await zapytaj("/");
  assert.equal(o.status, 200);
  assert.equal(o.naglowki["content-type"], "text/html; charset=utf-8");
  for (const [naglowek, wartosc] of Object.entries(NAGLOWKI_WYMAGANE)) assert.equal(o.naglowki[naglowek], wartosc, naglowek);
  assert.match(POLITYKA, /connect-src 'none'/);
  assert.match(POLITYKA, /frame-ancestors 'none'/);
  assert.equal(o.naglowki["cache-control"], "no-store");
  const brak = await zapytaj("/nie-ma.js");
  for (const [naglowek, wartosc] of Object.entries(NAGLOWKI_WYMAGANE)) assert.equal(brak.naglowki[naglowek], wartosc, `404: ${naglowek}`);
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

test("komunikat startu: domyślnie 127.0.0.1 bez ostrzeżenia, inny adres z ostrzeżeniem", () => {
  const lokalny = komunikatStartu("127.0.0.1", 8000);
  assert.match(lokalny, /http:\/\/127\.0\.0\.1:8000\//);
  assert.doesNotMatch(lokalny, /UWAGA/);
  const siec = komunikatStartu("0.0.0.0", 8000);
  assert.match(siec, /UWAGA/);
  assert.match(siec, /sieci lokalnej/);
  assert.match(siec, /tylko plików z generatora/);
});

test("wiersz poleceń: --host z innym adresem wypisuje ostrzeżenie, domyślnie słucha na 127.0.0.1", async () => {
  const uruchom = (argumenty) => new Promise((wynik, blad) => {
    const p = spawn(process.execPath, [fileURLToPath(new URL("../narzedzia/serwer.mjs", import.meta.url)), "--port", "0", ...argumenty]);
    let wyjscie = "";
    p.stdout.on("data", (d) => {
      wyjscie += d;
      if (wyjscie.includes("Ctrl+C")) {
        p.kill();
        wynik(wyjscie);
      }
    });
    p.on("error", blad);
    setTimeout(() => { p.kill(); blad(new Error(`brak komunikatu startu: ${wyjscie}`)); }, 5000);
  });
  const domyslny = await uruchom([]);
  assert.match(domyslny, /http:\/\/127\.0\.0\.1:\d+\//);
  assert.doesNotMatch(domyslny, /UWAGA/);
  // „localhost” to też adres pętli zwrotnej, więc test nie otwiera serwera na sieć, a sprawdza,
  // że każda wartość inna niż 127.0.0.1 daje ostrzeżenie.
  const inny = await uruchom(["--host", "localhost"]);
  assert.match(inny, /UWAGA/);
  assert.match(inny, /localhost/);
});

test("README wymienia ten sam komplet nagłówków co serwer lokalny", () => {
  const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");
  assert.ok(readme.includes(`Content-Security-Policy: ${POLITYKA}`), "polityka treści z frame-ancestors");
  for (const linia of ["Cross-Origin-Opener-Policy: same-origin", "X-Content-Type-Options: nosniff", "Referrer-Policy: no-referrer"]) {
    assert.ok(readme.includes(linia), linia);
  }
});

// Serwer na katalogu tymczasowym, żeby test nie zmieniał app/ (pliki w app/ liczy plik sum).
async function serwerNa(katalog) {
  const s = utworzSerwer(katalog);
  await new Promise((gotowe) => s.listen(0, "127.0.0.1", gotowe));
  return s;
}

test("dowiązanie prowadzące poza katalog strony: 404", async () => {
  const baza = mkdtempSync(join(tmpdir(), "serwer-"));
  try {
    mkdirSync(join(baza, "app"));
    writeFileSync(join(baza, "app", "index.html"), "strona\n");
    writeFileSync(join(baza, "tajne.txt"), "Zasady pracy\n");
    symlinkSync(join(baza, "tajne.txt"), join(baza, "app", "dowiazanie.txt"));
    symlinkSync(baza, join(baza, "app", "katalog"));
    const s = await serwerNa(join(baza, "app") + "/");
    try {
      const p = s.address().port;
      assert.equal((await zapytaj("/index.html", "GET", p)).status, 200);
      for (const sciezka of ["/dowiazanie.txt", "/katalog/tajne.txt"]) {
        const o = await zapytaj(sciezka, "GET", p);
        assert.equal(o.status, 404, sciezka);
        assert.equal(o.tresc.includes("Zasady pracy"), false, sciezka);
      }
    } finally {
      await new Promise((gotowe) => s.close(gotowe));
    }
  } finally {
    rmSync(baza, { recursive: true, force: true });
  }
});

test("plik, którego nie da się odczytać: błąd odpowiedzi, serwer działa dalej", async (t) => {
  if (process.getuid?.() === 0) return t.skip("proces działa jako root, a root czyta każdy plik");
  const baza = mkdtempSync(join(tmpdir(), "serwer-"));
  try {
    writeFileSync(join(baza, "index.html"), "strona\n");
    writeFileSync(join(baza, "zamkniety.js"), "x\n");
    chmodSync(join(baza, "zamkniety.js"), 0o000);
    const s = await serwerNa(baza + "/");
    try {
      const p = s.address().port;
      const o = await zapytaj("/zamkniety.js", "GET", p);
      assert.equal(o.status, 500);
      for (const [naglowek, wartosc] of Object.entries(NAGLOWKI_WYMAGANE)) assert.equal(o.naglowki[naglowek], wartosc, naglowek);
      assert.equal((await zapytaj("/index.html", "GET", p)).status, 200, "serwer działa dalej");
    } finally {
      await new Promise((gotowe) => s.close(gotowe));
    }
  } finally {
    chmodSync(join(baza, "zamkniety.js"), 0o600);
    rmSync(baza, { recursive: true, force: true });
  }
});

test("wiersz poleceń: --port spoza 0–65535 albo nie liczba kończy się komunikatem i kodem 2", () => {
  for (const zly of ["abc", "-1", "65536", "70000", "1.5", "", "8000x"]) {
    const w = spawnSync(process.execPath, [fileURLToPath(new URL("../narzedzia/serwer.mjs", import.meta.url)), "--port", zly], { encoding: "utf8", timeout: 5000 });
    assert.equal(w.status, 2, `--port ${JSON.stringify(zly)}`);
    assert.match(w.stderr, /--port/, `--port ${JSON.stringify(zly)}`);
  }
});
