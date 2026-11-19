#!/usr/bin/env node
// Lista skrótów SHA-256 plików z app/ (plik app/SHA256SUMS) i jej sprawdzenie.
// - Wszystkie zwykłe pliki w app/ poza samym SHA256SUMS.
// - Jedna linia na plik: skrót małymi literami, dwie spacje, ścieżka względem app/ z „/”, LF.
// - Linie posortowane po bajtach ścieżki w UTF-8.
// Ten sam format co program sha256sum, więc kopię sprawdza też `sha256sum -c SHA256SUMS`.
// Suma kontrolna kopii to SHA-256 samego pliku SHA256SUMS.
//
// Użycie:
//   node narzedzia/sumy.mjs --zapisz    zapisuje app/SHA256SUMS
//   node narzedzia/sumy.mjs --sprawdz   sprawdza app/SHA256SUMS (kod 1 przy rozbieżności)
//   opcja --katalog <ścieżka> zamiast app/

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../app/", import.meta.url));
const PLIK_SUM = "SHA256SUMS";

const sha256 = (bajty) => createHash("sha256").update(bajty).digest("hex");

function plikiKatalogu(katalog, biezacy = katalog) {
  const wynik = [];
  for (const wpis of readdirSync(biezacy, { withFileTypes: true })) {
    const sciezka = join(biezacy, wpis.name);
    if (wpis.isDirectory()) wynik.push(...plikiKatalogu(katalog, sciezka));
    else if (wpis.isFile()) wynik.push(relative(katalog, sciezka).split(sep).join("/"));
  }
  return wynik.filter((p) => p !== PLIK_SUM).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

export function listaSum(katalog = APP) {
  return plikiKatalogu(katalog).map((p) => `${sha256(readFileSync(join(katalog, p)))}  ${p}\n`).join("");
}

export function sprawdzSumy(katalog = APP) {
  const sciezkaSum = join(katalog, PLIK_SUM);
  if (!existsSync(sciezkaSum)) return { ok: false, roznice: [`brak pliku ${PLIK_SUM}`] };
  const zapisane = new Map();
  for (const linia of readFileSync(sciezkaSum, "utf8").split("\n").filter(Boolean)) {
    zapisane.set(linia.slice(66), linia.slice(0, 64));
  }
  const roznice = [];
  const pliki = plikiKatalogu(katalog);
  for (const [p, skrot] of zapisane) {
    if (!pliki.includes(p)) roznice.push(`brak pliku: ${p}`);
    else if (sha256(readFileSync(join(katalog, p))) !== skrot) roznice.push(`zmieniony: ${p}`);
  }
  for (const p of pliki) if (!zapisane.has(p)) roznice.push(`plik spoza listy: ${p}`);
  // Kolejność: najpierw zmienione, potem brakujące, na końcu dodatkowe.
  const waga = (r) => (r.startsWith("zmieniony") ? 0 : r.startsWith("brak") ? 1 : 2);
  roznice.sort((a, b) => waga(a) - waga(b));
  if (roznice.length === 0 && readFileSync(sciezkaSum, "utf8") !== listaSum(katalog)) roznice.push("zła kolejność albo format linii");
  return { ok: roznice.length === 0, roznice };
}

export function sumaKontrolna(katalog = APP) {
  return sha256(readFileSync(join(katalog, PLIK_SUM)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let values;
  try {
    ({ values } = parseArgs({ options: { zapisz: { type: "boolean" }, sprawdz: { type: "boolean" }, katalog: { type: "string" } } }));
  } catch (blad) {
    process.stderr.write(`sumy: ${blad.message}\n`);
    process.exit(2);
  }
  const katalog = values.katalog ?? APP;
  if (values.zapisz) {
    writeFileSync(join(katalog, PLIK_SUM), listaSum(katalog));
    process.stdout.write(`Zapisano ${PLIK_SUM}. Suma kontrolna kopii: ${sumaKontrolna(katalog)}\n`);
  } else if (values.sprawdz) {
    const w = sprawdzSumy(katalog);
    if (!w.ok) {
      process.stderr.write(`${w.roznice.join("\n")}\n`);
      process.exit(1);
    }
    process.stdout.write(`${PLIK_SUM} zgadza się z plikami. Suma kontrolna kopii: ${sumaKontrolna(katalog)}\n`);
  } else {
    process.stderr.write("sumy: podaj --zapisz albo --sprawdz\n");
    process.exit(2);
  }
}
