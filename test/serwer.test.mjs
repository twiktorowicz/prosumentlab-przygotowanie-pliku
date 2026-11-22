// Lokalny serwer plików (narzedzia/serwer.mjs): tylko katalog app/, tylko 127.0.0.1, ta sama
// polityka treści co na stronie.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, chmodSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
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

test("tylko GET i HEAD; HEAD i GET z długością treści", async () => {
  assert.equal((await zapytaj("/", "POST")).status, 405);
  const head = await zapytaj("/", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.tresc.length, 0);
  const rozmiar = readFileSync(fileURLToPath(new URL("../app/index.html", import.meta.url))).length;
  assert.equal(head.naglowki["content-length"], String(rozmiar), "HEAD");
  assert.equal((await zapytaj("/", "GET")).naglowki["content-length"], String(rozmiar), "GET");
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
    let bledy = "";
    p.stderr.on("data", (d) => {
      bledy += d;
    });
    const czas = setTimeout(() => { p.kill(); blad(new Error(`brak komunikatu startu: ${wyjscie}`)); }, 5000);
    // Podproces, który skończył się przed komunikatem startu (np. zajęty port), kończy test od
    // razu, bez czekania na limit czasu.
    p.on("exit", (kod) => {
      clearTimeout(czas);
      if (!wyjscie.includes("Ctrl+C")) blad(new Error(`serwer zakończył się kodem ${kod}: ${bledy}`));
    });
    p.on("error", (b) => {
      clearTimeout(czas);
      blad(b);
    });
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
    const s = await serwerNa(join(baza, "app") + sep);
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
    const s = await serwerNa(baza + sep);
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

test("katalog strony bez końcowego separatora: ten sam wynik, katalog obok o wspólnym początku nazwy niedostępny", async () => {
  const baza = mkdtempSync(join(tmpdir(), "serwer-"));
  try {
    mkdirSync(join(baza, "app"));
    mkdirSync(join(baza, "app2"));
    writeFileSync(join(baza, "app", "index.html"), "strona\n");
    writeFileSync(join(baza, "app2", "tajne.txt"), "Zasady pracy\n");
    for (const katalog of [join(baza, "app"), join(baza, "app") + sep]) {
      const s = await serwerNa(katalog);
      try {
        const p = s.address().port;
        assert.equal((await zapytaj("/", "GET", p)).tresc.toString(), "strona\n", katalog);
        assert.equal((await zapytaj("/index.html", "GET", p)).status, 200, katalog);
        for (const sciezka of ["/../app2/tajne.txt", "/..%2fapp2/tajne.txt", "/%2e%2e/app2/tajne.txt"]) {
          const o = await zapytaj(sciezka, "GET", p);
          assert.equal(o.status, 404, `${katalog} ${sciezka}`);
          assert.equal(o.tresc.includes("Zasady pracy"), false, sciezka);
        }
      } finally {
        await new Promise((gotowe) => s.close(gotowe));
      }
    }
  } finally {
    rmSync(baza, { recursive: true, force: true });
  }
});

test("wiersz poleceń: błąd startu podprocesu kończy test od razu", async () => {
  // Zajęty port: podproces kończy się kodem 2, zanim wypisze komunikat startu.
  const zajety = await serwerNa(join(fileURLToPath(new URL("../app/", import.meta.url))));
  try {
    const t0 = Date.now();
    const w = spawnSync(process.execPath, [fileURLToPath(new URL("../narzedzia/serwer.mjs", import.meta.url)), "--port", String(zajety.address().port)], { encoding: "utf8", timeout: 5000 });
    assert.equal(w.status, 2);
    assert.match(w.stderr, /serwer:/);
    assert.ok(Date.now() - t0 < 4000);
  } finally {
    await new Promise((gotowe) => zajety.close(gotowe));
  }
});

// Atrapa skryptu przyjmującego zgłoszenia (opcja --zgloszenie). Odpowiedź wybiera część adresu
// przed „@” w nagłówku X-Adres; każdy inny adres daje 200 z potwierdzeniem.
function wyslij({ port: naPorcie, sciezka = "/zgloszenie/", metoda = "POST", naglowki = {}, cialo = new Uint8Array([0x50, 0x4b, 5, 6]), czas = 0 }) {
  // cialo: null to żądanie bez ciała.
  return new Promise((wynik, blad) => {
    const z = request({ host: "127.0.0.1", port: naPorcie, path: sciezka, method: metoda, headers: naglowki }, (o) => {
      const czesci = [];
      o.on("data", (c) => czesci.push(c));
      o.on("end", () => wynik({ status: o.statusCode, naglowki: o.headers, tresc: Buffer.concat(czesci) }));
    });
    if (czas > 0) {
      z.setTimeout(czas, () => {
        z.destroy();
        wynik({ status: null, czas: true });
      });
    }
    z.on("error", blad);
    z.end(cialo ?? undefined);
  });
}

const ZGLOSZENIE = { "Content-Type": "application/zip", "X-Numer": "K7M3-Q9TX" };
const adres = (lokalna) => ({ ...ZGLOSZENIE, "X-Adres": `${lokalna}@example.com` });

async function zAtrapa(fn) {
  const s = utworzSerwer(undefined, { zgloszenie: true });
  await new Promise((gotowe) => s.listen(0, "127.0.0.1", gotowe));
  try {
    return await fn(s.address().port);
  } finally {
    s.closeAllConnections();
    await new Promise((gotowe) => s.close(gotowe));
  }
}

test("atrapa zgłoszeń: każda odpowiedź z kodem, stanem i nagłówkami jak w skrypcie", async () => {
  await zAtrapa(async (p) => {
    const przypadki = [
      ["jan", 200, { stan: "przyjete", numer: "K7M3-Q9TX", potwierdzenie: true }],
      ["przyjete", 200, { stan: "przyjete", numer: "K7M3-Q9TX", potwierdzenie: true }],
      ["bez-potwierdzenia", 200, { stan: "przyjete", numer: "K7M3-Q9TX", potwierdzenie: false }],
      ["zly-adres", 400, { stan: "zly_adres" }],
      ["za-duze", 413, { stan: "za_duze" }],
      ["limit", 429, { stan: "limit" }],
      ["niedostepne", 503, { stan: "niedostepne" }],
    ];
    for (const [lokalna, kod, json] of przypadki) {
      const o = await wyslij({ port: p, naglowki: adres(lokalna) });
      assert.equal(o.status, kod, lokalna);
      assert.deepEqual(JSON.parse(o.tresc.toString("utf8")), json, lokalna);
      assert.equal(o.naglowki["content-type"], "application/json; charset=utf-8", lokalna);
      assert.equal(o.naglowki["cache-control"], "no-store", lokalna);
      assert.equal(o.naglowki["x-content-type-options"], "nosniff", lokalna);
      for (const [naglowek, wartosc] of Object.entries(NAGLOWKI_WYMAGANE)) assert.equal(o.naglowki[naglowek], wartosc, `${lokalna}: ${naglowek}`);
      assert.equal(o.tresc.includes("example.com"), false, `${lokalna}: bez adresu w odpowiedzi`);
      if (kod === 429) assert.match(o.naglowki["retry-after"], /^[1-9]\d*$/, "Retry-After w sekundach");
      else assert.equal(o.naglowki["retry-after"], undefined, lokalna);
    }
  });
});

test("atrapa zgłoszeń: brak odpowiedzi, połączenie wisi; serwer obsługuje dalej inne żądania", async () => {
  await zAtrapa(async (p) => {
    const wisi = await wyslij({ port: p, naglowki: adres("brak-odpowiedzi"), czas: 500 });
    assert.deepEqual(wisi, { status: null, czas: true });
    assert.equal((await wyslij({ port: p, naglowki: adres("jan") })).status, 200);
    assert.equal((await zapytaj("/", "GET", p)).status, 200, "strona dalej podawana");
  });
});

test("atrapa zgłoszeń: inna metoda 405 z Allow: POST, zły typ 415, zły numer 400, za duże ciało 413", async () => {
  await zAtrapa(async (p) => {
    const get = await wyslij({ port: p, metoda: "GET", naglowki: {}, cialo: null });
    assert.equal(get.status, 405);
    assert.equal(get.naglowki.allow, "POST");
    assert.equal(get.tresc.length, 0);
    const typ = await wyslij({ port: p, naglowki: { ...adres("jan"), "Content-Type": "multipart/form-data" } });
    assert.deepEqual([typ.status, JSON.parse(typ.tresc).stan], [415, "zly_typ"]);
    const numer = await wyslij({ port: p, naglowki: { ...adres("jan"), "X-Numer": "K7M3-Q9TI" } });
    assert.deepEqual([numer.status, JSON.parse(numer.tresc).stan], [400, "zly_numer"]);
    const duze = await wyslij({ port: p, naglowki: adres("jan"), cialo: new Uint8Array(5 * 1024 * 1024 + 1) });
    assert.deepEqual([duze.status, JSON.parse(duze.tresc).stan], [413, "za_duze"]);
    const rowno = await wyslij({ port: p, naglowki: adres("jan"), cialo: new Uint8Array(5 * 1024 * 1024) });
    assert.equal(rowno.status, 200, "równo 5 MiB przyjęte");
  });
});

test("bez opcji --zgloszenie ścieżka /zgloszenie/ daje 404 dla każdej metody", async () => {
  for (const metoda of ["POST", "GET", "HEAD"]) {
    const o = await wyslij({ port, metoda, naglowki: adres("jan"), cialo: null });
    assert.equal(o.status, 404, metoda);
  }
  const zCialem = await wyslij({ port, naglowki: adres("jan") });
  assert.equal(zCialem.status, 404);
  assert.equal((await zapytaj("/", "POST")).status, 405, "inne ścieżki jak dotąd");
});

test("wiersz poleceń --zgloszenie: komunikat startu o atrapie; żądanie nie trafia na wyjście ani na dysk", async () => {
  const baza = mkdtempSync(join(tmpdir(), "serwer-"));
  const p = spawn(process.execPath, [fileURLToPath(new URL("../narzedzia/serwer.mjs", import.meta.url)), "--port", "0", "--zgloszenie"], { cwd: baza });
  try {
    let wyjscie = "";
    let bledy = "";
    p.stderr.on("data", (d) => { bledy += d; });
    const portAtrapy = await new Promise((wynik, blad) => {
      const czas = setTimeout(() => blad(new Error(`brak komunikatu startu: ${wyjscie}`)), 5000);
      p.stdout.on("data", (d) => {
        wyjscie += d;
        const m = /127\.0\.0\.1:(\d+)\//.exec(wyjscie);
        if (m && wyjscie.includes("Ctrl+C")) {
          clearTimeout(czas);
          wynik(Number(m[1]));
        }
      });
    });
    assert.match(wyjscie, /POST \/zgloszenie\//);
    const start = wyjscie;
    const tajne = "TRESC_ZGLOSZENIA";
    const o = await wyslij({ port: portAtrapy, naglowki: adres("tajny-klient"), cialo: new TextEncoder().encode(tajne) });
    assert.equal(o.status, 200);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(wyjscie, start, "nic nie dochodzi na standardowe wyjście");
    assert.equal(bledy, "");
    assert.deepEqual(readdirSync(baza), [], "nic nie powstaje w katalogu roboczym");
  } finally {
    p.kill();
    rmSync(baza, { recursive: true, force: true });
  }
});

test("komunikat startu z atrapą zgłoszeń opisuje, jak wybrać odpowiedź", () => {
  const k = komunikatStartu("127.0.0.1", 8000, { zgloszenie: true });
  assert.match(k, /POST \/zgloszenie\//);
  for (const lokalna of ["bez-potwierdzenia", "zly-adres", "za-duze", "limit", "niedostepne", "brak-odpowiedzi"]) assert.ok(k.includes(lokalna), lokalna);
  assert.doesNotMatch(komunikatStartu("127.0.0.1", 8000), /zgloszenie/);
});
