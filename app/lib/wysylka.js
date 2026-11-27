// Wysyłka zgłoszenia przez stronę: reguły bez DOM, wspólne dla strony i testów.
// - Sprawdzenie adresu e-mail przed wysłaniem. Narzędzie odrzuca adres, którego skrypt
//   przyjmujący i tak nie przyjmie, a który przy wysyłce dałby klientowi mylący komunikat:
//   nagłówek HTTP przenosi tylko znaki Latin-1, więc adres ze znakiem spoza ASCII skończyłby się
//   błędem przeglądarki, a nie odpowiedzią serwera. Pełnego sprawdzenia skryptu narzędzie nie
//   powtarza; pozostałe przypadki obsługuje odpowiedź 400 zly_adres.
// - Miejsca, w których wysyłka działa: strona pod https: oraz serwer próbny pod http: na
//   127.0.0.1 albo localhost. Gdzie indziej (plik otwarty lokalnie, serwer próbny w sieci domowej,
//   inna strona po HTTP) zostaje tylko zapis pliku.
// - Limit rozmiaru ZIP-a, limit czasu żądania i odliczanie sekund do jego końca.
// - Zamiana odpowiedzi skryptu przyjmującego na klucz tekstu z app/teksty.js.

import { obiekt } from "./json.js";

// ZIP najwyżej 5 MiB: większy skrypt przyjmujący odrzuca, zanim go odczyta.
export const LIMIT_ZIP = 5 * 1024 * 1024;
// Limit czasu żądania chroni przed wiszącym połączeniem. Krótszy groziłby błędem na stronie, choć
// skrypt zgłoszenie przyjął; typowe zgłoszenie po kompresji ma poniżej 1 MB, więc 60 s zostawia
// zapas także na wolnym łączu.
export const CZAS_WYSYLKI_MS = 60 * 1000;
// Po tylu milisekundach bez odpowiedzi strona pokazuje pod przyciskiem, ile sekund zostało do
// końca limitu czasu.
export const CZEKANIE_OD_MS = 5 * 1000;

const MAKS_DLUGOSC_ADRESU = 254;
// Znaki odrzucane przez skrypt przyjmujący: cudzysłów, nawiasy, przecinek, dwukropek, średnik,
// nawiasy ostre i kwadratowe, ukośnik wsteczny, kreska pionowa i odwrócony apostrof.
const ZNAKI_ODRZUCANE = /["(),:;<>[\]\\|`]/;

/**
 * Adres e-mail wpisany przez klienta. Po przycięciu odstępów na końcach: najwyżej 254 znaki,
 * tylko znaki ASCII od 0x21 do 0x7E (bez spacji i znaków sterujących), bez znaków odrzucanych
 * przez skrypt, nie zaczyna się od „-”, dokładnie jedno „@”, przed nim co najmniej jeden znak,
 * po nim domena z kropką (kropka nie na początku ani na końcu domeny).
 * @returns {{ ok: true, adres: string } | { ok: false }}
 */
export function sprawdzAdres(tekst) {
  if (typeof tekst !== "string") return { ok: false };
  const adres = tekst.trim();
  if (adres.length === 0 || adres.length > MAKS_DLUGOSC_ADRESU) return { ok: false };
  if (!/^[\x21-\x7e]+$/.test(adres) || ZNAKI_ODRZUCANE.test(adres) || adres.startsWith("-")) return { ok: false };
  const czesci = adres.split("@");
  if (czesci.length !== 2) return { ok: false };
  const [lokalna, domena] = czesci;
  if (lokalna.length === 0 || !domena.includes(".") || domena.startsWith(".") || domena.endsWith(".")) return { ok: false };
  return { ok: true, adres };
}

// `protokol` i `host` z location.protocol i location.hostname.
export function wysylkaDostepna(protokol, host) {
  if (protokol === "https:") return true;
  return protokol === "http:" && (host === "127.0.0.1" || host === "localhost");
}

export const zipZaDuzy = (bajty) => bajty > LIMIT_ZIP;

/**
 * Liczba sekund do końca limitu czasu do linii z odliczaniem, zaokrąglona w górę (do końca limitu
 * nigdy zero). Przez pierwsze CZEKANIE_OD_MS i po końcu limitu linii nie ma.
 * @param {number} uplynelo milisekundy od wysłania żądania
 * @returns {number | null} null: bez linii
 */
export function sekundyCzekania(uplynelo) {
  if (typeof uplynelo !== "number" || !(uplynelo >= CZEKANIE_OD_MS) || uplynelo >= CZAS_WYSYLKI_MS) return null;
  return Math.ceil((CZAS_WYSYLKI_MS - uplynelo) / 1000);
}

const blad = (klucz, przyPolu = false) => ({ wyslane: false, klucz, przyPolu });

/**
 * Odpowiedź skryptu przyjmującego jako wynik dla strony.
 * @param {{ status: number, json: unknown } | null | undefined} odpowiedz kod i treść odczytana
 *   jako JSON (null, gdy treść nie jest JSON-em); null albo brak, gdy odpowiedzi nie było (błąd
 *   sieci, przekroczony czas, przekierowanie)
 * @returns {{ wyslane: true, potwierdzenie: boolean }
 *   | { wyslane: false, klucz: string, przyPolu: boolean }}
 */
export function wynikWysylki(odpowiedz) {
  if (!odpowiedz) return blad("wysylka_blad_sieci");
  const { status, json } = odpowiedz;
  const stan = obiekt(json) ? json.stan : undefined;
  if (status === 200 && stan === "przyjete" && typeof json.potwierdzenie === "boolean") return { wyslane: true, potwierdzenie: json.potwierdzenie };
  if (status === 400 && stan === "zly_adres") return blad("wysylka_adres_blad", true);
  if (status === 413 && stan === "za_duze") return blad("wysylka_za_duzy");
  if (status === 429 && stan === "limit") return blad("wysylka_blad_limit");
  // Pozostałe kody, inne stany przy 400, odpowiedzi bez JSON-a (także z warstwy przed hostingiem)
  // i 200 bez przyjęcia.
  return blad("wysylka_blad_serwera");
}
