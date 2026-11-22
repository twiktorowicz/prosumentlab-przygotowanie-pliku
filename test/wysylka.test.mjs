// Wysyłka zgłoszenia przez stronę (app/lib/wysylka.js): sprawdzenie adresu e-mail przed
// wysłaniem, miejsca, w których wysyłka jest dostępna, limit rozmiaru ZIP-a i zamiana odpowiedzi
// skryptu przyjmującego na klucz tekstu, odliczanie sekund do końca limitu czasu. Adresy tylko
// w domenie example.invalid albo budowane w kodzie.

import { test } from "node:test";
import assert from "node:assert/strict";

import { sprawdzAdres, wysylkaDostepna, zipZaDuzy, wynikWysylki, sekundyCzekania, LIMIT_ZIP, CZAS_WYSYLKI_MS, CZEKANIE_OD_MS } from "../app/lib/wysylka.js";
import { rozmiarDoWyswietlenia } from "../app/lib/odmiana.js";
import { TEKSTY } from "../app/teksty.js";

const D = "example.invalid";

test("adres: poprawny adres przechodzi, spacje na końcach przycięte", () => {
  for (const [wpis, wynik] of [
    [`jan@${D}`, `jan@${D}`],
    [`  jan.kowalski+raport@${D} `, `jan.kowalski+raport@${D}`],
    [`a@b.${D}`, `a@b.${D}`],
    [`J_A-N@sub-domena.${D}`, `J_A-N@sub-domena.${D}`],
    [`x@${D}\t`, `x@${D}`],
  ]) assert.deepEqual(sprawdzAdres(wpis), { ok: true, adres: wynik }, JSON.stringify(wpis));
});

test("adres: brak „@”, kilka „@”, pusta część przed „@”, domena bez kropki albo z kropką na brzegu", () => {
  for (const zly of ["", "   ", "jan", `jan${D}`, `jan@@${D}`, `a@b@${D}`, `@${D}`, "jan@domena", "jan@", `jan@.${D}`, `jan@${D}.`]) {
    assert.deepEqual(sprawdzAdres(zly), { ok: false }, JSON.stringify(zly));
  }
});

test("adres: najwyżej 254 znaki po przycięciu spacji", () => {
  const lokalna = (n) => "a".repeat(n - `@${D}`.length);
  assert.equal(`${lokalna(254)}@${D}`.length, 254);
  assert.equal(sprawdzAdres(`${lokalna(254)}@${D}`).ok, true);
  assert.equal(sprawdzAdres(`  ${lokalna(254)}@${D}  `).ok, true, "spacje na końcach się nie liczą");
  assert.equal(sprawdzAdres(`${lokalna(255)}@${D}`).ok, false);
});

test("adres: tylko znaki ASCII od 0x21 do 0x7E; spacja, znaki sterujące i znaki spoza ASCII odrzucone", () => {
  for (const zly of [`ja n@${D}`, `jan@exa mple.invalid`, `ja\u0000n@${D}`, `ja\u007fn@${D}`, `ja\nn@${D}`, `jań@${D}`, `jan@przykład.invalid`, `jan\u00a0@${D}`, `jan@${D}\u200b`]) {
    assert.deepEqual(sprawdzAdres(zly), { ok: false }, JSON.stringify(zly));
  }
});

test("adres: znaki odrzucane przez skrypt przyjmujący i początek od „-”", () => {
  for (const znak of ['"', "(", ")", ",", ":", ";", "<", ">", "[", "]", "\\", "|", "`"]) {
    assert.deepEqual(sprawdzAdres(`ja${znak}n@${D}`), { ok: false }, znak);
  }
  assert.deepEqual(sprawdzAdres(`-jan@${D}`), { ok: false });
  assert.deepEqual(sprawdzAdres(`  -jan@${D}`), { ok: false }, "„-” na początku po przycięciu spacji");
  assert.equal(sprawdzAdres(`ja-n@${D}`).ok, true, "„-” w środku dozwolony");
  // Pozostałe znaki ASCII z zakresu, których skrypt nie odrzuca wprost, przechodzą (resztę
  // przypadków obsługuje odpowiedź 400 zly_adres).
  for (const znak of ["!", "#", "$", "%", "&", "'", "*", "+", "/", "=", "?", "^", "_", "{", "}", "~"]) {
    assert.equal(sprawdzAdres(`ja${znak}n@${D}`).ok, true, znak);
  }
});

test("adres: wartość inna niż tekst to błąd", () => {
  for (const zly of [undefined, null, 5, {}]) assert.deepEqual(sprawdzAdres(zly), { ok: false });
});

test("wysyłka dostępna pod https: oraz pod http: na 127.0.0.1 i localhost", () => {
  assert.equal(wysylkaDostepna("https:", "prosumentlab.pl"), true);
  assert.equal(wysylkaDostepna("https:", "127.0.0.1"), true);
  assert.equal(wysylkaDostepna("http:", "127.0.0.1"), true);
  assert.equal(wysylkaDostepna("http:", "localhost"), true);
  for (const [protokol, host] of [["http:", "192.168.1.20"], ["http:", "prosumentlab.pl"], ["file:", ""], ["http:", "0.0.0.0"], ["http:", "127.0.0.2"], ["http:", "localhost.example.invalid"]]) {
    assert.equal(wysylkaDostepna(protokol, host), false, `${protokol}//${host}`);
  }
});

test("limit ZIP-a: 5 242 880 bajtów, większy jest za duży", () => {
  assert.equal(LIMIT_ZIP, 5242880);
  assert.equal(zipZaDuzy(LIMIT_ZIP), false);
  assert.equal(zipZaDuzy(LIMIT_ZIP + 1), true);
  assert.equal(zipZaDuzy(1000), false);
});

// Limit 60 s chroni przed wiszącym połączeniem; dłuższe czekanie bez odpowiedzi byłoby dla
// klienta za długie, a krótsze grozi błędem, choć serwer zgłoszenie przyjął.
test("limit czasu wysyłki: 60 s", () => {
  assert.equal(CZAS_WYSYLKI_MS, 60000);
});

test("odliczanie: bez linii przez pierwsze 5 s, potem sekundy do końca limitu, zaokrąglone w górę", () => {
  assert.equal(CZEKANIE_OD_MS, 5000);
  for (const ms of [0, 1, 999, 4000, 4999]) assert.equal(sekundyCzekania(ms), null, String(ms));
  assert.equal(sekundyCzekania(5000), 55);
  assert.equal(sekundyCzekania(5001), 55, "część sekundy liczy się jako cała");
  assert.equal(sekundyCzekania(5999), 55);
  assert.equal(sekundyCzekania(6000), 54);
  assert.equal(sekundyCzekania(30500), 30);
  assert.equal(sekundyCzekania(58999), 2);
  assert.equal(sekundyCzekania(59000), 1);
  assert.equal(sekundyCzekania(59999), 1, "do końca limitu nigdy zero sekund");
  // Po limicie odpowiedź już nie przyjdzie: linia znika razem z komunikatem o błędzie.
  for (const ms of [60000, 60001, 120000]) assert.equal(sekundyCzekania(ms), null, String(ms));
  // Wartości spoza zakresu (zegar cofnięty, nie liczba): bez linii.
  for (const ms of [-1, Number.NaN, undefined, "6000"]) assert.equal(sekundyCzekania(ms), null, String(ms));
});

test("odliczanie: liczba sekund malejąca co sekundę od 55 do 1", () => {
  const sekundy = [];
  for (let ms = CZEKANIE_OD_MS; ms < CZAS_WYSYLKI_MS; ms += 1000) sekundy.push(sekundyCzekania(ms));
  assert.equal(sekundy.length, 55);
  sekundy.forEach((s, i) => assert.equal(s, 55 - i));
});

test("odpowiedź 200 przyjete: zgłoszenie wysłane, z potwierdzeniem albo bez", () => {
  assert.deepEqual(wynikWysylki({ status: 200, json: { stan: "przyjete", numer: "K7M3-Q9TX", potwierdzenie: true } }), { wyslane: true, potwierdzenie: true });
  assert.deepEqual(wynikWysylki({ status: 200, json: { stan: "przyjete", numer: "K7M3-Q9TX", potwierdzenie: false } }), { wyslane: true, potwierdzenie: false });
});

test("odpowiedzi z błędem: klucz tekstu według kodu i stanu, adres przy polu", () => {
  const przypadki = [
    [{ status: 400, json: { stan: "zly_adres" } }, { wyslane: false, klucz: "wysylka_adres_blad", przyPolu: true }],
    [{ status: 413, json: { stan: "za_duze" } }, { wyslane: false, klucz: "wysylka_za_duzy", przyPolu: false }],
    [{ status: 429, json: { stan: "limit" } }, { wyslane: false, klucz: "wysylka_blad_limit", przyPolu: false }],
  ];
  for (const [odpowiedz, wynik] of przypadki) assert.deepEqual(wynikWysylki(odpowiedz), wynik, JSON.stringify(odpowiedz));
});

test("inne kody, 400 innego rodzaju, odpowiedź bez JSON-a i 200 bez przyjęcia: błąd serwera", () => {
  const SERWER = { wyslane: false, klucz: "wysylka_blad_serwera", przyPolu: false };
  for (const odpowiedz of [
    { status: 400, json: { stan: "zly_numer" } }, { status: 400, json: { stan: "zly_zip" } }, { status: 400, json: null },
    { status: 403, json: { stan: "zly_origin" } }, { status: 404, json: null }, { status: 405, json: null },
    { status: 415, json: { stan: "zly_typ" } }, { status: 500, json: null }, { status: 502, json: { stan: "blad_wysylki" } },
    { status: 503, json: { stan: "niedostepne" } },
    // Warstwa przed hostingiem może odpowiedzieć 429 albo 413 bez JSON-a: to błąd serwera.
    { status: 429, json: null }, { status: 413, json: null }, { status: 429, json: { stan: "inny" } },
    { status: 200, json: null }, { status: 200, json: { stan: "inny" } }, { status: 200, json: { stan: "przyjete" } },
    { status: 200, json: { stan: "przyjete", potwierdzenie: "tak" } }, { status: 200, json: [] }, { status: 200, json: "przyjete" },
    { status: 201, json: { stan: "przyjete", potwierdzenie: true } },
  ]) assert.deepEqual(wynikWysylki(odpowiedz), SERWER, JSON.stringify(odpowiedz));
});

test("brak odpowiedzi (błąd sieci, przekroczony czas): błąd sieci", () => {
  for (const brak of [null, undefined]) assert.deepEqual(wynikWysylki(brak), { wyslane: false, klucz: "wysylka_blad_sieci", przyPolu: false });
});

test("każdy klucz z mapowania odpowiedzi ma tekst", () => {
  for (const k of ["wysylka_adres_blad", "wysylka_za_duzy", "wysylka_blad_limit", "wysylka_blad_serwera", "wysylka_blad_sieci"]) assert.ok(k in TEKSTY, k);
});

test("tekst odliczania ma wstawkę z liczbą sekund dokładnie raz", () => {
  assert.equal(TEKSTY.wysylka_czekanie.split("{sekundy}").length, 2);
});

test("rozmiar zgłoszenia do wyświetlenia: KB w górę do pełnych, od 1 MB z jednym miejscem po przecinku", () => {
  assert.equal(rozmiarDoWyswietlenia(1), "1 KB");
  assert.equal(rozmiarDoWyswietlenia(1024), "1 KB");
  assert.equal(rozmiarDoWyswietlenia(1025), "2 KB");
  assert.equal(rozmiarDoWyswietlenia(300 * 1024), "300 KB");
  assert.equal(rozmiarDoWyswietlenia(1024 * 1024 - 1), "1024 KB");
  assert.equal(rozmiarDoWyswietlenia(1024 * 1024), "1,0 MB");
  assert.equal(rozmiarDoWyswietlenia(Math.round(2.45 * 1024 * 1024)), "2,5 MB");
  assert.equal(rozmiarDoWyswietlenia(5 * 1024 * 1024), "5,0 MB");
  assert.equal(rozmiarDoWyswietlenia(5 * 1024 * 1024 + 1), "5,1 MB", "w górę, żeby ZIP ponad limit nie wyglądał na równy 5 MB");
});
