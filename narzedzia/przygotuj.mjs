#!/usr/bin/env node
// Wiersz poleceń narzędzia: pliki z licznika + dane formularza + numer + data -> plik ZIP.
// Służy do testów (także testów zgodności poza tym repozytorium). Wywołuje tę samą funkcję co
// strona (app/lib/zgloszenie.js), więc dla tych samych danych daje ten sam ZIP co do bajtu.
//
// W odróżnieniu od strony każdy plik, którego narzędzie nie przyjęło, kończy pracę błędem:
// w teście plik pominięty po cichu byłby gorszy niż zatrzymanie.
//
// Na standardowe wyjście błędów trafiają tylko kody, numery plików, numery wierszy i nazwy
// pól, nigdy treść danych.

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { przygotujZgloszenie } from "../app/lib/zgloszenie.js";
import { bladBudowyFormularza } from "../app/lib/formularz.js";
import { poprawnaDoba } from "../app/lib/kalendarz.js";
import { liczbaZCyfr } from "../app/lib/kwoty.js";

const POMOC = `Przygotowanie zgłoszenia z wiersza poleceń (do testów).

Użycie:
  node narzedzia/przygotuj.mjs --numer XXXX-XXXX --data RRRR-MM-DD [--formularz formularz.json]
                               --wyjscie wynik.zip plik1.csv [plik2.csv …]

Opcje:
  --numer       numer zgłoszenia, 8 znaków z alfabetu 0-9 A-Z bez I, L, O, U, zapis XXXX-XXXX
  --data        dzień utworzenia zapisywany w zgloszenie.json
  --formularz   plik JSON z surowymi wartościami pól: {"faktura": {…}, "instalacja": {…},
                "zgoda": true}; wartości pól to tekst (cena może być listą tekstów), zgoda
                true albo false; nieznany klucz albo zły typ to złe wywołanie (kod 2);
                bez tej opcji formularz jest pusty
  --wyjscie     ścieżka pliku ZIP
  --help        ta pomoc

Kody wyjścia:
  0  ZIP zapisany; na standardowym wyjściu kody uwag ("uwaga KOD gdzie")
  1  blokada, plik nieprzyjęty albo błąd pola; ZIP nie powstaje, kody na standardowym
     wyjściu błędów
  2  złe wywołanie
`;

class ZleWywolanie extends Error {}

function argumenty(lista) {
  let wynik;
  try {
    wynik = parseArgs({
      args: lista,
      allowPositionals: true,
      options: {
        numer: { type: "string" },
        data: { type: "string" },
        formularz: { type: "string" },
        wyjscie: { type: "string" },
        help: { type: "boolean", default: false },
      },
    });
  } catch (blad) {
    throw new ZleWywolanie(blad.message);
  }
  const { values, positionals } = wynik;
  if (values.help) return { pomoc: true };
  if (!/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(values.numer ?? "")) throw new ZleWywolanie("--numer: oczekiwany XXXX-XXXX");
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(values.data ?? "");
  if (!d || !poprawnaDoba(liczbaZCyfr(d[1]), liczbaZCyfr(d[2]), liczbaZCyfr(d[3]))) throw new ZleWywolanie("--data: oczekiwany istniejący dzień RRRR-MM-DD");
  if (!values.wyjscie) throw new ZleWywolanie("--wyjscie: wymagane");
  if (positionals.length === 0) throw new ZleWywolanie("podaj co najmniej jeden plik");

  let formularz = {};
  if (values.formularz) {
    try {
      formularz = JSON.parse(readFileSync(values.formularz, "utf8"));
    } catch {
      throw new ZleWywolanie("--formularz: nie da się odczytać pliku JSON");
    }
    // Zła budowa to złe wywołanie: test nie może przejść przez literówkę w kluczu.
    const zlyKlucz = bladBudowyFormularza(formularz);
    if (zlyKlucz) throw new ZleWywolanie(`--formularz: nieznany klucz albo zły typ wartości: ${zlyKlucz}`);
  }
  let pliki;
  try {
    pliki = positionals.map((sciezka) => new Uint8Array(readFileSync(sciezka)));
  } catch {
    throw new ZleWywolanie("nie da się odczytać pliku wejściowego");
  }
  return { numer: values.numer, data: values.data, formularz, wyjscie: values.wyjscie, pliki };
}

function uruchom(lista) {
  const a = argumenty(lista);
  if (a.pomoc) {
    process.stdout.write(POMOC);
    return 0;
  }
  const w = przygotujZgloszenie({ pliki: a.pliki, formularz: a.formularz, numer: a.numer, utworzono: a.data });

  const bledy = [];
  for (const p of w.pliki) {
    if (p.stan === "odrzucony" || p.stan === "blokada") {
      bledy.push(`plik ${p.indeks + 1}: ${p.kod}${p.wiersz === undefined ? "" : ` wiersz ${p.wiersz}`}`);
    }
  }
  for (const b of w.blokady) if (b.plik === undefined) bledy.push(`blokada: ${b.kod}`);
  for (const b of w.bledyPol) bledy.push(`pole ${b.pole}: ${b.kod}`);
  if (bledy.length > 0 || !w.moznaZapisac) {
    process.stderr.write(bledy.map((l) => `${l}\n`).join("") || `blokada: ${w.powod}\n`);
    return 1;
  }

  writeFileSync(a.wyjscie, w.zip);
  process.stdout.write(w.uwagi.map((u) => `uwaga ${u.kod} ${u.gdzie}\n`).join(""));
  return 0;
}

try {
  process.exitCode = uruchom(process.argv.slice(2));
} catch (blad) {
  if (!(blad instanceof ZleWywolanie)) throw blad;
  process.stderr.write(`przygotuj: ${blad.message}\n`);
  process.exitCode = 2;
}
