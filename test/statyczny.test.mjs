// N21: test statyczny katalogu app/. Narzędzie wysyła tylko zgłoszenie (jedno żądanie pod
// /zgloszenie/ z app/main.js), niczego nie zapisuje w przeglądarce, nie doładowuje kodu w trakcie
// pracy i nie wstawia tekstu jako HTML. Dodatkowo w app/lib/ nie ma zamiany tekstu na liczbę
// zmiennoprzecinkową ani obiektu Date z tekstu. Wyjątki: jedno wywołanie fetch z dosłownym
// adresem "/zgloszenie/" w app/main.js i odnośnik mailto: po zapisie (zwykły odnośnik, nie
// wywołanie). Udostępnianie (navigator.share) i schowek (navigator.clipboard) są zakazane wszędzie;
// ostrzeżenie przed opuszczeniem strony (beforeunload) jest dozwolone.
// Druga część reguł zamyka inne drogi, którymi dane mogłyby wyjść ze strony poza jednym fetch:
// zasoby ładowane przez element albo atrybut (obraz, arkusz stylów, ramka, skrypt), zmiana
// location, open(, cookieStore, WebTransport, window.name, wysłanie formularza, kliknięcie
// odnośnika zbudowanego w kodzie i dostęp do zakazanych nazw przez indeks ze sklejanego tekstu.
// Istniejący, uzasadniony kod, który te reguły by złapały, jest wypisany z osobna w WYJATKI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../app/", import.meta.url));

function pliki(katalog = APP) {
  const wynik = [];
  for (const wpis of readdirSync(katalog, { withFileTypes: true })) {
    const sciezka = join(katalog, wpis.name);
    if (wpis.isDirectory()) wynik.push(...pliki(sciezka));
    else wynik.push(sciezka);
  }
  return wynik;
}

const wzgledna = (s) => relative(APP, s).split(sep).join("/");

// Rodzaje plików w app/.
const js = (p) => p.endsWith(".js");
const html = (p) => p.endsWith(".html");
const css = (p) => p.endsWith(".css");
const svg = (p) => p.endsWith(".svg");

// [opis, wzorzec, czy dotyczy pliku (ścieżka względna), przykład, który musi trafić, przykład, który nie może]
const REGULY = [
  // fetch w app/main.js sprawdza osobny test: dokładnie jedno wywołanie z adresem "/zgloszenie/".
  ["fetch poza main.js", /\bfetch\b/, (p) => p !== "main.js", "fetch(url)", "prefetchowanie"],
  ["XMLHttpRequest", /XMLHttpRequest/, () => true, "new XMLHttpRequest()", "XmlHttp"],
  ["WebSocket", /WebSocket/, () => true, "new WebSocket(u)", "gniazdo"],
  ["sendBeacon", /sendBeacon/, () => true, "navigator.sendBeacon(u)", "send(x)"],
  ["EventSource", /EventSource/, () => true, "new EventSource(u)", "Event"],
  ["import()", /\bimport\s*\(/, () => true, "await import('./x.js')", 'import { a } from "./a.js";'],
  ["<form action>", /<form\b[^>]*\baction\s*=/i, () => true, '<form method="post" action="/x">', "<form>"],
  ["location =", /\blocation\s*=(?!=)/, () => true, "window.location = u", "location === x"],
  ["location.href =", /\blocation\.href\s*=(?!=)/, () => true, "location.href = u", "a.href = u"],
  ["location.assign/replace", /\blocation\.(?:assign|replace)\s*\(/, () => true, "location.assign(u)", "tekst.replace(a, b)"],
  ["window.open", /\bwindow\.open\s*\(/, () => true, "window.open(u)", "okno.open"],
  ['<script src="http', /<script\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\//i, () => true, '<script src="https://cdn/x.js">', '<script type="module" src="main.js">'],
  ['<link href="http', /<link\b[^>]*\bhref\s*=\s*["']?(?:https?:)?\/\//i, () => true, '<link rel="stylesheet" href="//cdn/x.css">', '<link rel="stylesheet" href="style.css">'],
  ["@import i url() z adresem zewnętrznym", /@import|url\(\s*["']?(?:https?:)?\/\//i, () => true, "src: url('https://x/f.woff2')", 'url("/czcionki/a.woff2")'],
  ["innerHTML", /\binnerHTML\b/, () => true, "el.innerHTML = t", "el.textContent = t"],
  ["outerHTML", /\bouterHTML\b/, () => true, "el.outerHTML = t", "el.textContent = t"],
  ["insertAdjacentHTML", /insertAdjacentHTML/, () => true, "el.insertAdjacentHTML('x', t)", "el.append(t)"],
  ["document.write", /\bdocument\.write(?:ln)?\s*\(/, () => true, "document.write(t)", "document.title"],
  ["localStorage", /localStorage/, () => true, "localStorage.setItem(a, b)", "pamiec"],
  ["sessionStorage", /sessionStorage/, () => true, "sessionStorage.x", "sesja"],
  ["indexedDB", /indexedDB/i, () => true, "indexedDB.open(x)", "indeks"],
  ["document.cookie", /document\.cookie/, () => true, "document.cookie = x", "ciastko"],
  ["eval w każdej postaci", /\beval\b/, () => true, "(0, window.eval)(x)", "ewaluacja"],
  ["Function( z new i bez", /\bFunction\s*\(/, () => true, "Function('return 1')()", 'typeof f === "function"'],
  ["caches", /\bcaches\b/, () => true, "caches.open(n)", "cache"],
  ["navigator.storage", /navigator\.storage\b/, () => true, "navigator.storage.persist()", "navigator.share"],
  ["BroadcastChannel", /BroadcastChannel/, () => true, "new BroadcastChannel(n)", "kanal"],
  ["serviceWorker", /serviceWorker/i, () => true, "navigator.serviceWorker.register(u)", "pracownik"],
  ["Worker i SharedWorker", /\b(?:Shared)?Worker\b/, () => true, "new SharedWorker(u)", "workerzy"],
  ["RTCPeerConnection", /RTCPeerConnection/, () => true, "new RTCPeerConnection()", "polaczenie"],
  ["new Image( i new Audio(", /\bnew\s+(?:Image|Audio)\s*\(/, () => true, "new Image()", "obrazek"],
  ["history.pushState i replaceState", /\b(?:pushState|replaceState)\b/, () => true, "history.replaceState(s, t, u)", "history.length"],
  ["postMessage", /postMessage/, () => true, "parent.postMessage(x, '*')", "wiadomosc"],
  ["DOMParser", /DOMParser/, () => true, "new DOMParser()", "parser"],
  ["createContextualFragment", /createContextualFragment/, () => true, "range.createContextualFragment(t)", "createElement(t)"],
  ["setHTMLUnsafe", /setHTMLUnsafe/, () => true, "el.setHTMLUnsafe(t)", "el.textContent = t"],
  ["srcdoc", /srcdoc/i, () => true, '<iframe srcdoc="x">', "src"],
  ["http-equiv refresh", /http-equiv\s*=\s*["']?refresh/i, () => true, '<meta http-equiv="refresh" content="0;u">', '<meta http-equiv="Content-Security-Policy" content="x">'],
  ["atrybut ping", /\bping\s*[=:]|["']ping["']/i, () => true, '<a href="x" ping="/p">', "mapping: x"],
  ["schemat javascript:", /javascript:/i, () => true, "href: 'javascript:void(0)'", "skrypt"],
  ["schematy ws: i wss:", /\bwss?:/i, () => true, '"wss://x"', "news"],
  ["adres //… bez schematu", /(?:["'`(]|=\s*)\/\/[^\s/"'`]/, () => true, 'src="//cdn.example/x.js"', "x = 1; // komentarz"],
  ["navigator.share i canShare", /navigator\.(?:share|canShare)\b/, () => true, "navigator.canShare({ files })", "navigator.language"],
  ["navigator.clipboard", /navigator\.clipboard\b/, () => true, "navigator.clipboard.writeText(ADRES)", "schowek"],
  ["Number( w lib", /\bNumber\s*\(/, (p) => p.startsWith("lib/"), "Number(t)", "Number.isSafeInteger(x)"],
  ["parseFloat w lib", /parseFloat/, (p) => p.startsWith("lib/"), "parseFloat(t)", "czytajKwote(t)"],
  ["parseInt w lib", /parseInt/, (p) => p.startsWith("lib/"), "parseInt(t, 10)", "liczbaZCyfr(t)"],
  ["Date.parse w lib", /Date\.parse/, (p) => p.startsWith("lib/"), "Date.parse(t)", "Date.UTC(r, m, d)"],
  ["new Date( w lib", /\bnew\s+Date\s*\(/, (p) => p.startsWith("lib/"), "new Date(2025, 0, 1)", "Date.UTC(2025, 0, 1)"],
  ["new Date(z argumentem) poza lib", /\bnew\s+Date\s*\((?!\s*\))/, (p) => !p.startsWith("lib/"), "new Date(tekst)", "new Date()"],

  // Po recenzji etapu B: inne drogi wyjścia danych ze strony.
  // Zasób ładowany przez atrybut albo cel żądania ustawiany w kodzie.
  ["przypisanie do src, srcset, href, action, formAction, data, poster, ping, background", /\.(?:src|srcset|href|action|formAction|data|poster|ping|background)\s*=(?!=)/, js, "obraz.src = adres", "e.srcObject; e.dataset.krok = n; e.href === x"],
  ["klucz src albo srcset w obiekcie (el(…, { src: … }))", /(?<![\w$-])src(?:set)?\s*:/, js, 'el("img", { src: adres })', 'el("p", { klasa: "x", tekst: "src" })'],
  ["setAttribute z atrybutem ładującym zasób albo celem żądania", /setAttribute(?:NS)?\s*\([^,)]*["'`](?:src|srcset|data|action|formaction|poster|background|ping|xlink:href|srcdoc|http-equiv)["'`]/i, js, 'e.setAttribute("src", adres)', 'e.setAttribute("aria-label", t)'],
  ["setAttribute z nazwą atrybutu ze zmiennej", /setAttribute(?:NS)?\s*\(\s*(?!["'`])/, js, "e.setAttribute(nazwa, adres)", 'e.setAttribute("aria-invalid", "true")'],
  // Elementy, które ładują zasób albo wysyłają dane, tworzone w kodzie.
  ["tworzenie elementu, który ładuje zasób albo wysyła dane", /(?:createElement(?:NS)?\s*\(\s*(?:[^,)]*,\s*)?|\bel\(\s*)["'`](?:img|image|script|link|iframe|frame|frameset|object|embed|applet|audio|video|source|track|picture|style|form|meta|base|portal|svg|use|area|map)["'`]/i, js, 'el("link", { rel: "stylesheet", href: adres })', 'el("a", { href: "/prywatnosc/" }); el("input", { type: "text" })'],
  ["createElement z nazwą ze zmiennej", /createElement(?:NS)?\s*\(\s*(?!["'`])/, js, "document.createElement(nazwa)", 'document.createElement("p")'],
  ["el( z nazwą elementu ze zmiennej", /(?<!function )\bel\(\s*(?!["'`])/, js, "el(nazwa, { src: adres })", 'function el(nazwa, atrybuty = {}) {} el("li", {})'],
  ["HTML: element, który ładuje zasób albo wysyła dane", /<(?:iframe|frame|frameset|object|embed|applet|audio|video|source|track|picture|portal|form|base|area|map)\b|<input\b[^>]*\btype\s*=\s*["']?image/i, html, '<iframe src="/x"></iframe>', "<details><summary>"],
  ["HTML: <img>, <link> i <script> tylko z listy wyjątków", /<(?:img|link|script)\b/i, html, '<img src="/x.png">', "<p>obrazek</p>"],
  ["CSS: url() tylko z listy wyjątków", /url\(/i, css, "background: url(/x.png)", "color: red"],
  ["SVG: odwołanie do zasobu, skrypt, obiekt obcy, styl", /\bhref\s*=|<(?:image|use|script|foreignObject|a|style|feImage)\b|url\(/i, svg, '<image href="x.png"/>', '<rect x="1" y="2"/>'],
  ["url( w skrypcie", /\burl\(/, js, 'e.style.background = "url(/x.png)"', "URL.createObjectURL(plik)"],
  ["styl ustawiany ze skryptu", /\.style\s*(?:\.|\[)|\bcssText\b|insertRule|CSSStyleSheet|adoptedStyleSheets/, js, 'e.style.backgroundImage = u', 'e.className = "uwaga"'],
  // Zmiana adresu strony i otwieranie okien.
  ["location: tylko odczyt location.protocol i location.hostname", /\blocation\b(?!\.(?:protocol|hostname)\b)/, () => true, 'location["href"] = adres', "wysylkaDostepna(location.protocol, location.hostname)"],
  ["open( w każdej postaci", /\bopen\s*\(/, () => true, "open(adres)", "szczegoly.open = true"],
  // Inne kanały.
  ["cookieStore", /cookieStore/, () => true, 'cookieStore.set("a", dane)', "ciastka"],
  ["WebTransport", /WebTransport/, () => true, "new WebTransport(adres)", "transport"],
  ["window.name i przypisanie do name", /\b(?:window|self|globalThis|top|parent|frames|opener)\s*\.\s*name\b|(?<![\w$.\-"'[])\bname\s*=(?!=)/, js, "window.name = dane", 'el("input", { name: nazwa }); $(`input[name="${n}"]`); pole.name === "x"'],
  ["wysłanie formularza (.submit( i requestSubmit()", /\.(?:requestS|s)ubmit\s*\(/, () => true, "formularz.submit()", "przycisk wysyłki"],
  ["kliknięcie z kodu (.click() tylko z listy wyjątków)", /\.click\s*\(/, () => true, "odnosnik.click()", 'addEventListener("click", f)'],
  ["sztuczne zdarzenia (dispatchEvent, MouseEvent, PointerEvent)", /\bdispatchEvent\b|\bnew\s+(?:Mouse|Pointer)Event\b/, js, 'a.dispatchEvent(new MouseEvent("click"))', 'addEventListener("click", f)'],
  ["setTimeout i setInterval z tekstem do wykonania", /set(?:Timeout|Interval)\s*\(\s*["'`]/, js, 'setTimeout("wyslij()", 10)', "setTimeout(przelicz, 250)"],
  // Nazwy składane w kodzie.
  ["dostęp przez indeks do obiektów okna i przeglądarki", /\b(?:window|self|globalThis|top|parent|frames|opener|navigator|document|location)\s*(?:\?\.)?\s*\[/, js, 'window["fe" + "tch"](adres)', "window.scrollTo(0, 0)"],
  // Indeks to nawias kwadratowy tuż za nazwą, nawiasem albo „?.”; nawias po spacji, „(”, „=” albo
  // „,” to lista, nie indeks.
  ["dostęp przez indeks ze sklejanego tekstu", /(?:(?<=[\w$)\]])|(?<=\?\.))\[\s*(?:`|\[|["'][^"'\]\n]*["']\s*\+|[\w$.]+\s*\+\s*["'`])/, js, 'navigator["sendBe" + "acon"](adres, dane)', 'TEKSTY[klucz]; $(`[data-zmiana="${i}"]`); pliki[i + 1]; const x = [`${a} b`, [1]]'],
  ["Reflect", /\bReflect\b/, js, "Reflect.get(window, nazwa)", "refleks"],
  ["nazwy składane z kodów znaków (fromCharCode, fromCodePoint, atob)", /fromCharCode|fromCodePoint|\batob\b/, () => true, "String.fromCharCode(102, 101)", "tekst.charCodeAt(0)"],
];

// Świadome wyjątki od reguł wyjścia danych: istniejący, uzasadniony kod. Każdy wyjątek to dokładny
// fragment pliku z liczbą wystąpień; test skanu wycina je przed sprawdzeniem reguł, więc każdy
// inny kod pod te reguły nie przejdzie, a zmiana fragmentu albo dopisanie kolejnego wymaga
// zmiany tej listy.
const WYJATKI = [
  // Pomocnik el(): jedyne miejsce, gdzie powstają elementy. Nazwa elementu jest dosłowna w każdym
  // wywołaniu el(…) (reguła „el( z nazwą elementu ze zmiennej”), a nazwy elementów ładujących
  // zasób są zakazane (reguła „tworzenie elementu…”).
  ["main.js", "  const e = document.createElement(nazwa);", 1],
  // el(): atrybuty z dosłownych kluczy obiektu w wywołaniu; klucze src i ping łapią reguły
  // „klucz src…” i „atrybut ping”, wartości href sprawdza test odnośników niżej.
  ["main.js", '    else if (v === true) e.setAttribute(k, "");', 1],
  ["main.js", "    else if (v !== false && v !== undefined && v !== null) e.setAttribute(k, v);", 1],
  // Zapis pliku: kliknięcie odnośnika z adresem blob: (plik ZIP w pamięci) i atrybutem download
  // w funkcji zapisz. Jedyne kliknięcie z kodu w app/.
  ["main.js", "  a.click();", 1],
  // Rysunki faktury w kroku 2: pliki SVG z app/.
  ["index.html", '<img src="faktura-strona-1.svg" width="262" height="305" alt="">', 1],
  ["index.html", '<img src="faktura-strona-2.svg" width="262" height="305" alt="">', 1],
  // Arkusz stylów i skrypt strony z app/.
  ["index.html", '<link rel="stylesheet" href="style.css">', 1],
  ["index.html", '<script type="module" src="main.js"></script>', 1],
  // Czcionki strony z /czcionki/ na tej samej stronie (lokalnie ich nie ma, przeglądarka dostaje 404).
  ...["Sans-Regular", "Sans-Medium", "Sans-SemiBold", "Sans-Bold", "Mono-Regular", "Mono-Medium"].flatMap((k) =>
    ["Latin1", "Latin2"].map((z) => ["style.css", `url("/czcionki/IBMPlex${k}-${z}.woff2")`, 1])),
];

// Treść pliku bez fragmentów z listy wyjątków.
function bezWyjatkow(p, tresc) {
  for (const [plik, fragment] of WYJATKI) if (plik === p) tresc = tresc.split(fragment).join("");
  return tresc;
}

test("N21: reguły testu statycznego trafiają w przykłady i nie trafiają w kod dozwolony", () => {
  for (const [opis, wzorzec, , trafia, nieTrafia] of REGULY) {
    assert.match(trafia, wzorzec, `${opis}: przykład zakazany`);
    assert.doesNotMatch(nieTrafia, wzorzec, `${opis}: przykład dozwolony`);
  }
});

test("N21: w app/ nie ma zabronionych wywołań (poza wyjątkami z listy WYJATKI)", () => {
  const trafienia = [];
  for (const sciezka of pliki()) {
    const p = wzgledna(sciezka);
    if (p === "SHA256SUMS") continue;
    const tresc = bezWyjatkow(p, readFileSync(sciezka, "utf8"));
    for (const [opis, wzorzec, dotyczy] of REGULY) {
      if (dotyczy(p) && wzorzec.test(tresc)) trafienia.push(`${p}: ${opis}`);
    }
  }
  assert.deepEqual(trafienia, []);
});

test("wyjątki od reguł wyjścia danych: każdy fragment jest w pliku dokładnie tyle razy, ile podaje lista", () => {
  for (const [plik, fragment, liczba] of WYJATKI) {
    const tresc = readFileSync(join(APP, plik), "utf8");
    assert.equal(tresc.split(fragment).length - 1, liczba, `${plik}: ${fragment}`);
  }
  // Kliknięcie z kodu tylko w zapisie pliku, w funkcji zapisz, na odnośniku z atrybutem download.
  const main = readFileSync(join(APP, "main.js"), "utf8");
  const zapisz = /\nfunction zapisz\(\) \{\n([\s\S]*?)\n\}\n/.exec(main)?.[1] ?? "";
  assert.match(zapisz, /const a = el\("a", \{ href: adres, download: gotowy\.wynik\.nazwaZip \}\);\n[\s\S]*\n  a\.click\(\);/);
  assert.match(zapisz, /const adres = URL\.createObjectURL\(new Blob\(\[gotowy\.bajty\], \{ type: "application\/zip" \}\)\);/);
  // createElement i setAttribute ze zmiennej tylko w pomocniku el().
  const el = /\nfunction el\(nazwa, atrybuty = \{\}, \.\.\.dzieci\) \{\n([\s\S]*?)\n\}\n/.exec(main)?.[1] ?? "";
  for (const [plik, fragment] of WYJATKI.slice(0, 3)) assert.ok(plik === "main.js" && el.includes(fragment.trim()), fragment);
});

test("odnośniki budowane w kodzie (el(\"a\", …)): href tylko z listy", () => {
  // Wartości href w el("a", …): dwie strony serwisu w nowej karcie, repozytorium, odnośnik mailto:
  // po zapisie pliku (adres zgłoszeń z tematem i treścią) i adres blob: pliku ZIP przy zapisie.
  const DOZWOLONE = ['"/prywatnosc/"', '"/jak-pobrac-dane-z-elicznika/"', "ADRES_REPOZYTORIUM", "mailto", "adres"];
  const main = readFileSync(join(APP, "main.js"), "utf8");
  const wartosci = [...main.matchAll(/el\("a", \{[^}]*?\bhref: ([^,}]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(wartosci.sort(), [...DOZWOLONE].sort());
  // Każdy klucz href w obiekcie w main.js należy do jednego z tych odnośników.
  assert.equal((main.match(/\bhref:/g) ?? []).length, DOZWOLONE.length);
  for (const p of pliki().map(wzgledna).filter((x) => js(x) && x !== "main.js")) {
    assert.doesNotMatch(readFileSync(join(APP, p), "utf8"), /\bhref:/, p);
  }
});

test("reguły wyjścia danych łapią przykłady z recenzji etapu B", () => {
  const PRZYKLADY = [
    'el("img", { src: adres })', "obraz.src = adres", 'document.createElement("img")', 'document.createElement("script")',
    'document.createElement("iframe")', 'el("link", { rel: "stylesheet", href: adres })', "location.pathname = adres",
    'location["href"] = adres', "window.location.search = dane", "document.location.hash = dane", "open(adres)",
    'cookieStore.set("a", dane)', "window.name = dane", "name = dane", "new WebTransport(adres)", 'window["fe" + "tch"](adres)',
    'navigator["sendBe" + "acon"](adres, dane)', "globalThis[nazwa](adres)", "formularz.submit()", "formularz.requestSubmit()",
    'const a = el("a", { href: adres }); a.click();', 'a.dispatchEvent(new MouseEvent("click"))', 'e.setAttribute("src", adres)',
    "e.setAttribute(nazwa, adres)", "a.href = adres", 'e.style.backgroundImage = "url(" + adres + ")"', "const x = ok[`fe${t}`]",
    'ok?.["fe" + "tch"](adres)', 'ok[["fe", "tch"].join("")](adres)', 'ok[nazwa + "tch"](adres)',
  ];
  for (const przyklad of PRZYKLADY) {
    assert.ok(REGULY.some(([, wzorzec, dotyczy]) => dotyczy("main.js") && wzorzec.test(przyklad)), przyklad);
  }
  for (const przyklad of ['<iframe src="/x"></iframe>', '<link rel="prefetch" href="/x">', '<img src="/x.png">', '<object type="x"></object>', '<input type="image" src="/x">']) {
    assert.ok(REGULY.some(([, wzorzec, dotyczy]) => dotyczy("index.html") && wzorzec.test(przyklad)), przyklad);
  }
  assert.ok(REGULY.some(([, wzorzec, dotyczy]) => dotyczy("faktura-strona-1.svg") && wzorzec.test('<image href="https://x.example/a.png"/>')));
  assert.ok(REGULY.some(([, wzorzec, dotyczy]) => dotyczy("style.css") && wzorzec.test('background: url("/x.png")')));
});

// Świadome wyjątki: wywołania dozwolone tylko w app/main.js i tylko tyle razy.
const WYJATKI_MAIN = [
  // Jedyne ustawienie href przez setAttribute: odnośnik mailto: w kroku 2 (ustawWiadomosc).
  ['setAttribute("href", mailto)', /\.setAttribute\(\s*["'`]href["'`]\s*,\s*mailto\s*\)/g, 1],
];

test("N21: świadome wyjątki tylko w app/main.js, z liczbą wystąpień", () => {
  const main = readFileSync(join(APP, "main.js"), "utf8");
  for (const [opis, wzorzec, liczba] of WYJATKI_MAIN) assert.equal((main.match(wzorzec) ?? []).length, liczba, opis);
  // setAttribute("href", …) tylko w ustawWiadomosc i tylko z adresem mailto.
  const wiadomosc = /\nfunction ustawWiadomosc\(mailto\) \{\n([\s\S]*?)\n\}\n/.exec(main)?.[1] ?? "";
  assert.match(wiadomosc, /m\.setAttribute\("href", mailto\)/);
  const zle = [];
  for (const sciezka of pliki()) {
    const p = wzgledna(sciezka);
    if (p === "SHA256SUMS") continue;
    const tresc = readFileSync(sciezka, "utf8");
    for (const m of tresc.matchAll(/setAttribute\(\s*["'`]href["'`]\s*,\s*([^)]*)\)/g)) {
      if (!(p === "main.js" && m[1].trim() === "mailto")) zle.push(`${p}: setAttribute("href", ${m[1]})`);
    }
    if (p !== "main.js") {
      for (const [opis, wzorzec] of WYJATKI_MAIN) if (wzorzec.test(tresc)) zle.push(`${p}: ${opis}`);
    }
  }
  assert.deepEqual(zle, []);
  assert.equal(`x.setAttribute("href", u)`.match(/setAttribute\(\s*["'`]href["'`]\s*,\s*([^)]*)\)/)[1], "u", "reguła łapie setAttribute z dowolną wartością");
});

test("N21: fetch dokładnie raz, w app/main.js, z dosłownym pierwszym argumentem \"/zgloszenie/\"", () => {
  // Każde wystąpienie słowa, także w komentarzu, liczy się jako wywołanie: komentarz nie może
  // ukryć drugiego żądania, a test nie musi rozbierać kodu.
  const main = readFileSync(join(APP, "main.js"), "utf8");
  const wystapienia = [...main.matchAll(/\bfetch\b/g)];
  assert.equal(wystapienia.length, 1, "jedno wystąpienie słowa fetch w main.js");
  assert.equal(main.slice(wystapienia[0].index, wystapienia[0].index + 'fetch("/zgloszenie/", {'.length), 'fetch("/zgloszenie/", {');
  // Poza main.js żadnego wystąpienia (reguła „fetch poza main.js”).
  const poza = pliki().map(wzgledna).filter((p) => p !== "main.js" && p !== "SHA256SUMS" && /\bfetch\b/.test(readFileSync(join(APP, p), "utf8")));
  assert.deepEqual(poza, []);
  // Reguła łapie wywołanie z innym adresem, ze zmienną i przez window.
  for (const zly of ['fetch(adres, {', 'fetch("/inny/", {', "window.fetch('/zgloszenie/')"]) {
    assert.notEqual(zly.slice(zly.search(/\bfetch\b/), zly.search(/\bfetch\b/) + 'fetch("/zgloszenie/", {'.length), 'fetch("/zgloszenie/", {', zly);
  }
});

test("N21: ostrzeżenie przed opuszczeniem strony (beforeunload) nie jest zakazane", () => {
  for (const [opis, wzorzec] of REGULY) assert.doesNotMatch('window.addEventListener("beforeunload", ostrzez);', wzorzec, opis);
});

test("N21: jedyny adres poza stroną to mailto: do zgłoszeń i odnośniki do strony i repozytorium", () => {
  // http://www.w3.org/2000/svg to identyfikator przestrzeni nazw w atrybucie xmlns pliku SVG;
  // przeglądarka niczego spod niego nie pobiera.
  const dozwolone = [/^http:\/\/www\.w3\.org\/2000\/svg$/, /^mailto:raporty@prosumentlab\.pl/, /^mailto:\$\{ADRES\}\?/, /^https:\/\/github\.com\/twiktorowicz\/prosumentlab-przygotowanie-pliku(?:\/|$)/];
  const zle = [];
  for (const sciezka of pliki()) {
    const p = wzgledna(sciezka);
    if (p === "SHA256SUMS") continue;
    const tresc = readFileSync(sciezka, "utf8");
    // Także w literałach szablonowych: adres kończy się dopiero na wstawce ${…} albo backticku.
    for (const m of tresc.matchAll(/\b(?:https?:\/\/|mailto:)[^\s"'`)<>]*/g)) {
      if (!dozwolone.some((d) => d.test(m[0]))) zle.push(`${p}: ${m[0]}`);
    }
  }
  assert.deepEqual(zle, []);
});

test("N21: reguły adresów łapią literały szablonowe i setAttribute", () => {
  assert.match("href: `/inna/`", /\bhref(?:\s*=\s*|:\s*)["'`](\/[^"'`]*)["'`]/);
  assert.match("`https://x.example/${a}`", /\b(?:https?:\/\/|mailto:)[^\s"'`)<>]*/);
});

test("N21: odnośniki do stron serwisu tylko do /, /prywatnosc/ i /jak-pobrac-dane-z-elicznika/", () => {
  // „/” to strona główna z napisu w nagłówku, otwierana w nowej karcie (wczytane pliki zostają).
  const DOZWOLONE = new Set(["/", "/prywatnosc/", "/jak-pobrac-dane-z-elicznika/"]);
  const znalezione = new Set();
  const zle = [];
  for (const sciezka of pliki()) {
    const p = wzgledna(sciezka);
    if (p === "SHA256SUMS") continue;
    const tresc = readFileSync(sciezka, "utf8");
    // Wartość w cudzysłowie, apostrofach albo w literale szablonowym.
    for (const m of tresc.matchAll(/\bhref(?:\s*=\s*|:\s*)["'`](\/[^"'`]*)["'`]/g)) {
      znalezione.add(m[1]);
      if (!DOZWOLONE.has(m[1])) zle.push(`${p}: ${m[1]}`);
    }
  }
  assert.deepEqual(zle, []);
  assert.deepEqual([...znalezione].sort(), ["/", "/jak-pobrac-dane-z-elicznika/", "/prywatnosc/"]);
});
