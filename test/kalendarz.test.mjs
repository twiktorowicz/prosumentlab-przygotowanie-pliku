// Kalendarz bez zegara przeglądarki: znaczniki rozbierane z tekstu, zmiana czasu z reguły UE.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rozbierzZnacznik,
  godzinaZZnacznika,
  godzinyDoby,
  godzinMiesiaca,
  numerDnia,
  dobaZNumeru,
  ostatniaNiedziela,
  porzadek,
  zPorzadku,
  istniejeGodzina,
} from "../app/lib/kalendarz.js";

test("rozbiór znacznika: poprawne i błędne", () => {
  assert.deepEqual(rozbierzZnacznik("2025-06-06 01:00"), { ok: true, rok: 2025, miesiac: 6, dzien: 6, godzina: 1 });
  assert.deepEqual(rozbierzZnacznik("2025-06-06 24:00"), { ok: true, rok: 2025, miesiac: 6, dzien: 6, godzina: 24 });
  assert.deepEqual(rozbierzZnacznik("2025-06-06 01:15"), { ok: false, kod: "nie_godzinowe" });
  for (const zly of ["2025-02-30 01:00", "2025-13-01 01:00", "2025-06-06 25:00", "2025-6-6 01:00", "06.06.2025 01:00", "2025-06-06T01:00", ""]) {
    assert.deepEqual(rozbierzZnacznik(zly), { ok: false, kod: "data" }, zly);
  }
  assert.equal(rozbierzZnacznik("2024-02-29 01:00").ok, true);
  assert.equal(rozbierzZnacznik("2025-02-29 01:00").ok, false);
});

test("znacznik oznacza koniec godziny; 00:00 i 24:00 kończą ostatnią godzinę doby poprzedniej", () => {
  const g = (t) => godzinaZZnacznika(rozbierzZnacznik(t));
  assert.deepEqual(g("2025-06-06 01:00"), { doba: { rok: 2025, miesiac: 6, dzien: 6 }, godzina: 0 });
  assert.deepEqual(g("2025-06-07 00:00"), { doba: { rok: 2025, miesiac: 6, dzien: 6 }, godzina: 23 });
  assert.deepEqual(g("2025-06-06 24:00"), { doba: { rok: 2025, miesiac: 6, dzien: 6 }, godzina: 23 });
  assert.deepEqual(g("2026-01-01 00:00"), { doba: { rok: 2025, miesiac: 12, dzien: 31 }, godzina: 23 });
  assert.deepEqual(g("2024-03-01 00:00"), { doba: { rok: 2024, miesiac: 2, dzien: 29 }, godzina: 23 });
});

test("ostatnie niedziele marca i października", () => {
  assert.equal(ostatniaNiedziela(2025, 3), 30);
  assert.equal(ostatniaNiedziela(2025, 10), 26);
  assert.equal(ostatniaNiedziela(2026, 3), 29);
  assert.equal(ostatniaNiedziela(2026, 10), 25);
  assert.equal(ostatniaNiedziela(2024, 10), 27);
});

test("godziny doby: 23, 24 i 25", () => {
  assert.equal(godzinyDoby({ rok: 2025, miesiac: 3, dzien: 30 }).length, 23);
  assert.equal(godzinyDoby({ rok: 2025, miesiac: 10, dzien: 26 }).length, 25);
  assert.equal(godzinyDoby({ rok: 2025, miesiac: 6, dzien: 6 }).length, 24);
  const pazdziernik = godzinyDoby({ rok: 2025, miesiac: 10, dzien: 26 });
  assert.deepEqual(pazdziernik.slice(1, 5), [
    { godzina: 1, wystapienie: 1 }, { godzina: 2, wystapienie: 1 }, { godzina: 2, wystapienie: 2 }, { godzina: 3, wystapienie: 1 },
  ]);
  assert.equal(istniejeGodzina({ rok: 2025, miesiac: 3, dzien: 30 }, 2, 1), false);
  assert.equal(istniejeGodzina({ rok: 2025, miesiac: 10, dzien: 26 }, 2, 2), true);
  assert.equal(istniejeGodzina({ rok: 2025, miesiac: 10, dzien: 27 }, 2, 2), false);
});

test("N13: liczba godzin miesiąca", () => {
  assert.equal(godzinMiesiaca(2025, 3), 743);
  assert.equal(godzinMiesiaca(2025, 10), 745);
  assert.equal(godzinMiesiaca(2025, 4), 720);
  assert.equal(godzinMiesiaca(2024, 2), 696);
  assert.equal(godzinMiesiaca(2025, 1), 744);
});

test("numer dnia i doba z numeru, także dla lat przestępnych", () => {
  assert.equal(numerDnia({ rok: 1970, miesiac: 1, dzien: 1 }), 0);
  for (const doba of [
    { rok: 2024, miesiac: 2, dzien: 29 }, { rok: 2025, miesiac: 12, dzien: 31 }, { rok: 2000, miesiac: 3, dzien: 1 },
    { rok: 2099, miesiac: 12, dzien: 31 }, { rok: 2026, miesiac: 1, dzien: 1 },
  ]) {
    assert.deepEqual(dobaZNumeru(numerDnia(doba)), doba);
  }
  assert.equal(numerDnia({ rok: 2026, miesiac: 1, dzien: 1 }) - numerDnia({ rok: 2025, miesiac: 12, dzien: 31 }), 1);
});

test("porządek godzin: kolejność w dobie 25-godzinnej i powrót z porządku", () => {
  const doba = { rok: 2025, miesiac: 10, dzien: 26 };
  const p = godzinyDoby(doba).map(({ godzina, wystapienie }) => porzadek(doba, godzina, wystapienie));
  for (let i = 1; i < p.length; i++) assert.ok(p[i] > p[i - 1]);
  assert.ok(porzadek({ rok: 2025, miesiac: 10, dzien: 27 }, 0, 1) > p.at(-1));
  assert.deepEqual(zPorzadku(porzadek(doba, 2, 2)), { doba, godzina: 2, wystapienie: 2 });
});

test("wynik nie zależy od strefy czasowej procesu", async () => {
  const { execFileSync } = await import("node:child_process");
  const skrypt = `
    import { godzinMiesiaca, ostatniaNiedziela, numerDnia } from ${JSON.stringify(new URL("../app/lib/kalendarz.js", import.meta.url).href)};
    console.log(JSON.stringify([godzinMiesiaca(2025, 3), godzinMiesiaca(2025, 10), ostatniaNiedziela(2026, 3), numerDnia({ rok: 2026, miesiac: 3, dzien: 29 })]));
  `;
  const wyniki = ["Pacific/Auckland", "America/New_York", "UTC"].map((tz) =>
    execFileSync(process.execPath, ["--input-type=module", "-e", skrypt], { env: { ...process.env, TZ: tz }, encoding: "utf8" }),
  );
  assert.equal(new Set(wyniki).size, 1);
});
