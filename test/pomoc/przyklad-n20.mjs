// Przykład do testu N20: pełna struktura faktury i zgłoszenia (z sekcją weryfikacji), wartości
// zmyślone, plik pomiarów z generatora. Osobny moduł, żeby wzorzec test/wzorce/n20.zip dało się
// odtworzyć poza testem. ZIP powstaje asynchronicznie (obietnica); wzorzec to wariant bez
// kompresji, czyli wynik w środowisku bez CompressionStream("deflate-raw").

import { zawartoscZip } from "../../app/lib/zgloszenie.js";
import { utworzZip } from "../../app/lib/zip.js";
import { crc32 } from "../../app/lib/crc32.js";
import { generuj } from "../../narzedzia/generator.mjs";

const N1 = { od: "2025-06-06", do: "2025-06-07", taryfa: "G13", ziarno: 1 };
const NUMER = "K7M3-Q9TX";
const DATA = "2026-11-19";

export async function przykladN20() {
  const pomiary = new TextDecoder().decode(generuj(N1).bezNumerow);
  const zgloszenie = {
    format: "prosumentlab/zgloszenie",
    wersja_formatu: 1,
    narzedzie: "0.1.0",
    numer: NUMER,
    utworzono: DATA,
    zgoda_przypadek_testowy: false,
    tryb: "tauron",
    ppe_porownane: true,
    pliki: [{
      nazwa: "pomiary_1.csv",
      wariant_wejscia: "surowy",
      kodowanie_wejscia: "iso-8859-2",
      wiersze_danych: 96,
      pierwszy_znacznik: "2025-06-06 01:00",
      ostatni_znacznik: "2025-06-08 00:00",
      usuniete_kolumny: ["Nr platnika", "Nr punktu poboru energii"],
    }],
    zakres: { pelne_miesiace: 0, ciag_miesiace: 0, klasyfikacja: "za_krotki" },
    uwagi: [{ kod: "FAKTURA_W_POZA_ZAKRESEM", gdzie: "weryfikacja[0]" }],
  };
  const faktury = {
    format: "prosumentlab/faktury",
    wersja_formatu: 1,
    raport: {
      sprzedawca: "tauron_sprzedaz",
      operator_dystrybucyjny: "tauron_dystrybucja",
      taryfa: "g13",
      okres_od: "2025-05-01",
      okres_do: "2025-05-31",
      rodzaj_faktury: "rozliczeniowa",
      system_rozliczenia: "net_billing_rce",
      rodzaj_ceny: "dynamiczna",
      cena_energii_netto_zl_kwh: "0.51234",
      oplata_mocowa_zl_mies: "12.34",
      oplata_abonamentowa_zl_mies: "5.67",
      oplata_stala_sieciowa_zl_mies: "8.90",
    },
    weryfikacja: [{
      okres_od: "2025-05-01",
      okres_do: "2025-05-31",
      rodzaj_faktury: "rozliczeniowa",
      pobor_kwh_strefy: [11, 22, 333],
      oddanie_kwh_strefy: [100, 200, 300],
      pobor_kwh_suma: 366,
      oddanie_kwh_suma: 600,
      sprzedaz_energii: { netto: "100.00", vat: "23.00", brutto: "123.00" },
      dystrybucja: { netto: "50.00", vat: "11.50", brutto: "61.50" },
      stawki_dystrybucji_netto_zl_kwh: {
        skladnik_zmienny_sieciowy: ["0.20000", "0.30000", "0.10000"],
        jakosciowa: ["0.03000", "0.03000", "0.03000"],
        oze: ["0.00700", "0.00700", "0.00700"],
        kogeneracyjna: ["0.00300", "0.00300", "0.00300"],
      },
      wynik_rozliczenia_brutto: "184.50",
      depozyt_w_okresie: "0.00",
      depozyt_uzyty: "123.00",
      do_zaplaty: "61.50",
    }],
    stan_depozytu: [{ stan_na: "2025-04-15", ostatnia_faktura_za: "2025-03", suma: "1234.56" }],
  };
  const bajtyPomiarow = new TextEncoder().encode(pomiary);
  const pomiar = { bajty: bajtyPomiarow, crc: crc32(bajtyPomiarow) };
  return utworzZip(zawartoscZip({ zgloszenie, faktury, instalacja: null, pomiary: [pomiar] }));
}

