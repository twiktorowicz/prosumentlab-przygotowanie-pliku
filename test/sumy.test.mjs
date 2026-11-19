// N23: app/SHA256SUMS zgadza się z plikami w app/, jest posortowany po bajtach ścieżki w UTF-8
// i nie obejmuje samego siebie. Format jak w programie sha256sum, więc każdy sprawdzi kopię
// poleceniem `sha256sum -c SHA256SUMS`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listaSum, sprawdzSumy, sumaKontrolna } from "../narzedzia/sumy.mjs";

const APP = fileURLToPath(new URL("../app/", import.meta.url));
const SKRYPT = fileURLToPath(new URL("../narzedzia/sumy.mjs", import.meta.url));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

test("N23: app/SHA256SUMS zgadza się z plikami, jest posortowany i bez samego siebie", () => {
  const zapisany = readFileSync(join(APP, "SHA256SUMS"), "utf8");
  assert.equal(zapisany, listaSum(APP), "plik sum jest aktualny (node narzedzia/sumy.mjs --zapisz)");
  const linie = zapisany.split("\n");
  assert.equal(linie.pop(), "", "LF po ostatniej linii");
  const sciezki = linie.map((l) => {
    assert.match(l, /^[0-9a-f]{64} {2}[^ ].*$/, l);
    return l.slice(66);
  });
  assert.equal(sciezki.includes("SHA256SUMS"), false);
  const posortowane = [...sciezki].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  assert.deepEqual(sciezki, posortowane);
  for (const l of linie) assert.equal(l.slice(0, 64), sha256(readFileSync(join(APP, l.slice(66)))), l.slice(66));
  assert.ok(sciezki.includes("index.html") && sciezki.includes("lib/zip.js"));
  assert.deepEqual(sprawdzSumy(APP), { ok: true, roznice: [] });
});

function katalogProbny() {
  const k = mkdtempSync(join(tmpdir(), "sumy-"));
  mkdirSync(join(k, "lib"));
  writeFileSync(join(k, "b.js"), "b\n");
  // Wielka litera z innej nazwy: systemy plików bez rozróżniania wielkości liter (macOS)
  // traktują „b.js” i „B.js” jako jeden plik.
  writeFileSync(join(k, "C.js"), "C\n");
  writeFileSync(join(k, "lib", "z.js"), "z\n");
  writeFileSync(join(k, "lib-a.css"), "a\n");
  writeFileSync(join(k, "ą.txt"), "ą\n");
  return k;
}

test("lista sum: sortowanie po bajtach UTF-8 (wielkie litery przed małymi, „-” przed „/”, polskie znaki na końcu)", () => {
  const k = katalogProbny();
  try {
    const sciezki = listaSum(k).trimEnd().split("\n").map((l) => l.slice(66));
    assert.deepEqual(sciezki, ["C.js", "b.js", "lib-a.css", "lib/z.js", "ą.txt"]);
  } finally {
    rmSync(k, { recursive: true, force: true });
  }
});

test("sprawdzenie wykrywa zmieniony, brakujący i dodatkowy plik", () => {
  const k = katalogProbny();
  try {
    writeFileSync(join(k, "SHA256SUMS"), listaSum(k));
    assert.deepEqual(sprawdzSumy(k), { ok: true, roznice: [] });
    writeFileSync(join(k, "b.js"), "zmieniony\n");
    rmSync(join(k, "lib", "z.js"));
    writeFileSync(join(k, "nowy.js"), "n\n");
    assert.deepEqual(sprawdzSumy(k), {
      ok: false,
      roznice: ["zmieniony: b.js", "brak pliku: lib/z.js", "plik spoza listy: nowy.js"],
    });
  } finally {
    rmSync(k, { recursive: true, force: true });
  }
});

test("suma kontrolna kopii to SHA-256 pliku SHA256SUMS", () => {
  assert.equal(sumaKontrolna(APP), sha256(readFileSync(join(APP, "SHA256SUMS"))));
});

test("wiersz poleceń: --sprawdz kod 0 i suma kontrolna; zły katalog kod 1; bez opcji kod 2", () => {
  const ok = spawnSync(process.execPath, [SKRYPT, "--sprawdz"], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, new RegExp(`Suma kontrolna kopii: ${sumaKontrolna(APP)}`));
  const k = katalogProbny();
  try {
    writeFileSync(join(k, "SHA256SUMS"), "0".repeat(64) + "  b.js\n");
    const zle = spawnSync(process.execPath, [SKRYPT, "--sprawdz", "--katalog", k], { encoding: "utf8" });
    assert.equal(zle.status, 1);
    assert.match(zle.stderr, /zmieniony: b\.js/);
  } finally {
    rmSync(k, { recursive: true, force: true });
  }
  assert.equal(spawnSync(process.execPath, [SKRYPT], { encoding: "utf8" }).status, 2);
});

test("zgodność z programem sha256sum, jeśli jest w systemie", (t) => {
  const w = spawnSync("sha256sum", ["-c", "--quiet", "SHA256SUMS"], { cwd: APP, encoding: "utf8" });
  if (w.error) return t.skip("brak programu sha256sum");
  assert.equal(w.status, 0, w.stdout + w.stderr);
});
