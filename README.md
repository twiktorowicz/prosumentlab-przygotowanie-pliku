# prosumentlab-przygotowanie-pliku

Narzędzie do przygotowania pliku godzinowego z licznika przed wysłaniem go do ProsumentLab.
Działa w przeglądarce. Wysyła tylko przygotowane zgłoszenie i dopiero wtedy, gdy wybierzesz
„Wyślij zgłoszenie”.

## Co robi

- Przyjmuje jeden albo kilka plików godzinowych z eLicznika Taurona (CSV).
- Usuwa z nich numer punktu poboru (PPE) i numer płatnika. Wartości tych numerów nie są nigdzie
  pokazywane ani zapisywane, także jako skrót.
- Sprawdza, czy w wyniku nie zostało nic, co wygląda na numer PPE, długi numer albo adres e-mail.
  Jeśli zostało, nie tworzy pliku ZIP.
- Liczy, ile pełnych miesięcy obejmują dane, i porównuje pliki, które na siebie zachodzą.
- Zbiera liczby i nazwy przepisane z faktury oraz nieobowiązkowe odpowiedzi o instalacji.
- Pokazuje podgląd plików zgłoszenia: pliki JSON w całości, pliki pomiarów w skrócie (liczba
  wierszy, pierwsza i ostatnia godzina, początek pliku, sumy miesięczne). Wysyła ZIP razem
  z Twoim adresem e-mail przez stronę. Zamiast tego możesz zapisać ZIP na urządzeniu i wysłać go
  sam, mailem.

Usunięcie dwóch numerów nie czyni danych anonimowymi. W pliku ZIP zostaje godzinowy profil
poboru i oddania energii, a zgłoszenie łączy go z Twoim adresem e-mail. Dlatego o tym, co dzieje
się z plikiem po wysłaniu, mówi informacja o przetwarzaniu danych.

Pliki z licznika narzędzie czyta i przetwarza w pamięci przeglądarki; plik pobrany z eLicznika
zostaje na urządzeniu bez zmian i nie jest wysyłany. Narzędzie nie używa `localStorage`,
`sessionStorage`, `IndexedDB` ani ciasteczek, więc po zamknięciu karty dane znikają. Polityka
treści strony pozwala na żądania tylko do tej samej strony (`connect-src 'self'`).

## Kreator

Narzędzie prowadzi przez sześć kroków na jednej stronie. Widoczny jest zawsze jeden krok, a nad
nim napis „Krok 2 z 6” i pasek postępu.

1. **Plik z eLicznika:** wybór plików, wynik ich odczytu i zakres danych.
2. **Faktura:** sposób rozliczenia energii oddanej, sprzedawca, miesiąc faktury i korekta,
   z rysunkiem faktury z numerami pól.
3. **Cena energii:** rodzaj ceny, grupa taryfowa, ceny i nieobowiązkowe opłaty stałe.
4. **Dodatkowe dane:** nieobowiązkowe odpowiedzi o instalacji.
5. **Sprawdzenie i zgoda:** podgląd plików zgłoszenia z rozmiarem ZIP-a, zgoda na przypadek testowy
   i numer zgłoszenia.
6. **Wysyłka:** adres e-mail i przycisk „Wyślij zgłoszenie” albo droga zapasowa.

„Dalej” sprawdza tylko bieżący krok: zatrzymuje się przy błędzie w polu albo blokadzie, a brak
danych z faktury tylko opisuje i pozwala iść dalej. „Wstecz” niczego nie sprawdza i niczego nie
kasuje. Przycisk „wstecz” przeglądarki nie zmienia kroku. Dopóki są wczytane pliki, a zgłoszenie
z aktualnymi danymi nie zostało wysłane ani zapisane, przeglądarka pyta przed opuszczeniem strony.

## Wysyłka zgłoszenia

- **Co jest wysyłane:** plik ZIP z plikami, które pokazuje podgląd w kroku 5 (`zgloszenie.json`,
  `faktury.json` i `instalacja.json`, gdy są dane, oraz `pomiary_1.csv` … `pomiary_10.csv` bez
  numeru PPE i numeru płatnika), i adres e-mail wpisany w kroku 6. Adres nie trafia do ZIP-a ani
  do podglądu. Plik pobrany z eLicznika i faktura nie są wysyłane.
- **Kiedy:** tylko po wybraniu przycisku „Wyślij zgłoszenie”. Klawisz Enter w polu adresu nie
  zaczyna wysyłki, a jedno kliknięcie to jedno żądanie.
- **Pod jaki adres:** `POST` pod względny adres `/zgloszenie/` tej samej strony, z ZIP-em w treści
  i nagłówkami `Content-Type: application/zip`, `X-Numer` (numer zgłoszenia) i `X-Adres` (adres
  e-mail), bez ciasteczek i bez przekierowań. Poza tym żądaniem strona pobiera tylko własne pliki
  (skrypty, arkusz stylów, rysunki faktury, czcionki). Test statyczny (`test/statyczny.test.mjs`)
  pilnuje, żeby w `app/` było dokładnie jedno wywołanie `fetch`, z tym adresem, i odrzuca znane
  inne sposoby wysyłania danych. To straż przed przypadkowym dopisaniem wysyłki, nie dowód, że
  innej drogi nie da się napisać: test czyta tekst plików, nie rozbiera kodu.
- Przed wysłaniem narzędzie sprawdza adres e-mail (postać `nazwa@domena`, tylko znaki ASCII,
  najwyżej 254 znaki) i rozmiar ZIP-a: większego niż 5 MiB nie wysyła przez stronę.
- Limit czasu żądania to 60 s. Gdy odpowiedzi nie ma po 5 s, pod przyciskiem widać, ile sekund
  zostało do końca limitu.
- Odpowiedź serwera zamienia na komunikat `app/lib/wysylka.js`. Po przyjęciu strona pokazuje numer
  zgłoszenia, podany adres e-mail i informację, czy potwierdzenie zostało wysłane. Po nieudanej
  próbie przycisk jest znów aktywny, a droga zapasowa zostaje pod ręką.
- Wysyłka przez stronę działa pod adresem `https:` oraz na serwerze próbnym pod
  `http://127.0.0.1` i `http://localhost`. Gdzie indziej (plik otwarty z dysku, serwer próbny
  w sieci domowej, inna strona po HTTP) narzędzie pokazuje od razu drogę zapasową, a funkcja
  wysyłki sama odmawia wysłania żądania.

## Droga zapasowa: zapis pliku i wiadomość

Pod przyciskiem wysyłki jest „Wolę zapisać plik i wysłać go sam”. Droga ma dwa kroki: zapis ZIP-a
na urządzeniu pod nazwą `prosumentlab_<numer>.zip` i „Napisz nową wiadomość”, czyli odnośnik
`mailto:` do raporty@prosumentlab.pl z numerem zgłoszenia w temacie. Plik dołączasz sam:
wiadomość otwiera się bez załącznika i jest aktywna dopiero po zapisie. Po zmianie danych
potwierdzenie zapisu znika, bo zapisany plik już im nie odpowiada. Zapis, wiadomość i wysyłka
przez stronę używają tego samego ZIP-a.

## Kompresja ZIP-a

ZIP powstaje po wejściu na krok 5 (podgląd pokazuje wtedy rozmiar zgłoszenia) i czeka w pamięci
do zmiany danych, więc wysyłka i zapis nie czekają na kompresję. Pliki w ZIP-ie są kompresowane
metodą deflate (metoda 8) przez `CompressionStream("deflate-raw")` przeglądarki; sumy CRC-32 są
liczone z danych przed kompresją. Przeglądarka bez tej funkcji albo nieudana kompresja dają ZIP
bez kompresji (metoda 0), który da się zapisać, a wysłać przez stronę, jeśli mieści się w 5 MiB.
Gdy ZIP nie powstanie żadną metodą, krok 6 prosi o powrót i ponowną próbę.

Budowa ZIP-a jest stała: ta sama data plików, bez pól dodatkowych, komentarzy i deskryptora
danych, pliki zawsze w tej samej kolejności. Ta sama implementacja kompresji daje ten sam ZIP co
do bajtu; różne przeglądarki mogą dać różne bajty po kompresji przy tej samej zawartości. Z danymi
z generatora zgłoszenie za 12 miesięcy ma po kompresji około 90 KB, a największe (10 plików po
12 miesięcy) mniej niż 1 MB.

## Narzędzie a AI

- Kod tego narzędzia powstaje z pomocą asystenta AI (Claude). Autor przegląda zmiany przed ich
  przyjęciem, a działanie sprawdzają testy z tego repozytorium.
- Narzędzie działa w Twojej przeglądarce. Wysyła tylko zgłoszenie, do nas, i dopiero po wybraniu
  „Wyślij zgłoszenie”. Nie wysyła niczego do żadnej usługi AI. Możesz to sprawdzić w kodzie albo
  w karcie sieci w narzędziach przeglądarki.
- Co dzieje się z plikiem ZIP, który wyślesz przez stronę albo mailem, opisuje informacja
  o przetwarzaniu danych: https://prosumentlab.pl/prywatnosc/ (punkt 2).

## Jak uruchomić lokalnie

Potrzebny jest Node (wersja z `.github/workflows/ci.yml`). Bez npm i bez instalowania czegokolwiek.

```sh
node narzedzia/serwer.mjs                # strona pod http://127.0.0.1:8000/
node narzedzia/serwer.mjs --zgloszenie   # to samo z atrapą przyjmowania zgłoszeń
node --test "test/**/*.test.mjs"         # testy
```

Moduły ES nie działają z `file://`, dlatego potrzebny jest lokalny serwer plików. Serwer słucha
tylko na `127.0.0.1` i serwuje wyłącznie katalog `app/`. Czcionek strony w repozytorium nie ma,
więc lokalnie strona używa czcionki systemowej.

Dane do prób tworzy generator danych syntetycznych:

```sh
mkdir -p proby                   # katalog wykluczony z repozytorium
node narzedzia/generator.mjs --od 2025-01-01 --do 2025-12-31 --wyjscie proby/rok_2025.csv
node narzedzia/generator.mjs --help
```

Ten sam ZIP co strona (te same moduły z `app/lib/`) buduje z wiersza poleceń
`narzedzia/przygotuj.mjs`; opis opcji: `node narzedzia/przygotuj.mjs --help`.

## Atrapa przyjmowania zgłoszeń

Bez opcji `--zgloszenie` serwer odpowiada na `/zgloszenie/` kodem 404, a strona pokazuje
komunikat o błędzie serwera. Z opcją serwer udaje skrypt przyjmujący zgłoszenia: na
`POST /zgloszenie/` odpowiada JSON-em w tej samej postaci co strona. Najpierw sprawdza metodę
(405), typ treści (415), rozmiar do 5 MiB (413) i postać numeru zgłoszenia (400), potem wybiera
odpowiedź według części adresu e-mail przed „@”:

| Część adresu przed „@” | Odpowiedź |
|---|---|
| `bez-potwierdzenia` | 200, zgłoszenie przyjęte, potwierdzenie niewysłane |
| `zly-adres` | 400 `zly_adres` |
| `za-duze` | 413 `za_duze` |
| `limit` | 429 `limit` |
| `niedostepne` | 503 `niedostepne` |
| `brak-odpowiedzi` | brak odpowiedzi; połączenie zamykane po 150 s, dłużej niż limit czasu narzędzia |
| każda inna | 200, zgłoszenie przyjęte, potwierdzenie wysłane |

Dzięki temu każdą odpowiedź da się sprawdzić bez restartu serwera, wpisując inny adres, na
przykład `limit@example.invalid`. Atrapa niczego nie zapisuje na dysku, nie wypisuje treści
żądania ani adresu i nie wysyła żadnych wiadomości. Nie sprawdza nagłówka `Origin`, limitów
dziennych ani budowy ZIP-a.

## Nagłówki serwera

Katalog `app/` może podawać dowolny serwer plików, ale przy każdej odpowiedzi musi wysyłać cztery
nagłówki. Polityka treści w znaczniku `<meta>` strony nie obejmuje `frame-ancestors`, dlatego
nagłówek `Content-Security-Policy` ma tę samą politykę co `index.html` i dodatkowo
`frame-ancestors 'none'`:

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'
Cross-Origin-Opener-Policy: same-origin
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

Lokalny serwer (`narzedzia/serwer.mjs`) wysyła te same nagłówki; `test/serwer.test.mjs` pilnuje,
żeby lista tutaj zgadzała się z serwerem.

## Próba w przeglądarce na komputerze

`narzedzia/proba-przegladarki.mjs` uruchamia Chrome albo Chromium bez okna i własny serwer
z atrapą przyjmowania zgłoszeń, a potem przechodzi kreator na plikach z generatora, na szerokości
1280 px i 390 px (z ekranem dotykowym): sześć kroków, „Dalej” zatrzymane błędem i niezatrzymane
brakiem danych, „Wstecz” bez utraty danych, rozmiar ZIP-a po kompresji, wysyłkę z każdą
odpowiedzią atrapy (także odliczanie przy braku odpowiedzi), drogę zapasową z zapisem ZIP-a,
pytanie przed opuszczeniem strony, blokady i pola formularza. Sprawdza też, że strona nie wysyła
żadnego zapytania poza własne pliki i `POST` pod `/zgloszenie/`, nie pisze błędów w konsoli
i niczego nie zostawia w przeglądarce. Nie należy do `node --test` ani do CI, bo wymaga
zainstalowanej przeglądarki.

```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node narzedzia/proba-przegladarki.mjs
node narzedzia/proba-przegladarki.mjs --chrome /usr/bin/chromium --zostaw   # zostawia zrzuty
```

## Odbiór na telefonie

Telefon nie sięgnie do `127.0.0.1` komputera, więc do odbioru serwer trzeba wystawić w sieci
domowej. Używaj wyłącznie plików z generatora. Strona podana w sieci domowej działa bez HTTPS,
więc wysyłka przez stronę jest tam niedostępna, a krok 6 pokazuje od razu drogę zapasową.

1. Przygotuj pliki z generatora, na przykład cały rok i drugi plik z dwoma punktami poboru do
   sprawdzenia blokady:

   ```sh
   mkdir -p proby
   node narzedzia/generator.mjs --od 2025-01-01 --do 2025-12-31 --wyjscie proby/rok_2025.csv
   node narzedzia/generator.mjs --od 2026-01-01 --do 2026-01-31 --drugi-ppe \
     --wyjscie proby/dwa_punkty.csv
   ```

2. Przenieś oba pliki na telefon (AirDrop, wiadomość do siebie, dysk w chmurze). Na iPhonie zapisz
   je w aplikacji Pliki, na Androidzie w Pobranych.
3. Połącz komputer i telefon z tą samą siecią Wi-Fi. Sprawdź adres komputera w tej sieci:
   macOS `ipconfig getifaddr en0`, Linux `hostname -I`, Windows `ipconfig` (adres IPv4).
4. Uruchom serwer na wszystkich adresach komputera. Serwer wypisze ostrzeżenie, że strona jest
   widoczna w sieci lokalnej. Zapora systemu może zapytać o zgodę dla Node.

   ```sh
   node narzedzia/serwer.mjs --host 0.0.0.0
   ```

5. Na telefonie otwórz `http://<adres komputera>:8000/` w Safari (iOS) albo Chrome (Android).
6. Przejdź kreator:
   - krok 1: przed dodaniem pliku sekcja zakresu mówi, że zakres pojawi się po dodaniu pliku,
     a „Dalej” prosi o plik; dodaj `rok_2025.csv`: plakietka „Przyjęty”, zakres „12 pełnych
     miesięcy”;
   - kroki 2 i 3: wypełnij pola dowolnymi zmyślonymi liczbami; liczba wpisana od przecinka („,3”)
     po wyjściu z pola dostaje zero na początku; cena „1” zmienia się na „1,00”, a cena „51” daje
     komunikat o cenie w groszach i zatrzymuje „Dalej”; przy G13 cena w pozostałych godzinach
     wyższa niż w szczytach daje uwagę o zamienionych cenach, która niczego nie zatrzymuje;
     rozwiń „Co to znaczy?” przy kilku polach;
   - krok 4: odpowiedzi o instalacji są nieobowiązkowe, „Dalej” działa bez nich;
   - krok 5: pliki z ZIP-a i tabela miesięcy są zwinięte, pod podglądem jest rozmiar zgłoszenia,
     a na końcu kroku zdanie, że wybranie „Dalej” jeszcze nie wysyła zgłoszenia;
   - „Wstecz” wraca do wcześniejszych kroków z wpisanymi wartościami;
   - krok 6: zamiast pola adresu jest komunikat, że wysyłka przez stronę działa tylko pod adresem
     strony, i od razu droga zapasowa. „Napisz nową wiadomość” jest nieaktywne, dopóki plik nie
     jest zapisany. Dotknij „Zapisz plik ZIP”; plik ma nazwę `prosumentlab_<numer>.zip` z numerem
     ze strony (iOS: aplikacja Pliki, Pobrane; Android: Pobrane). Chrome może przy zapisie
     ostrzegać o pobieraniu pliku bez HTTPS; wtedy wybierz „Zachowaj”;
   - dotknij „Napisz nową wiadomość”: aplikacja poczty otwiera się z adresem
     raporty@prosumentlab.pl, tematem z numerem zgłoszenia i treścią z przypomnieniem
     o załączniku; plik nie jest dołączony. **Nie wysyłaj tej wiadomości**, zamknij ją bez
     wysyłania;
   - wróć do kroku 1 i dodaj `dwa_punkty.csv`: plik dostaje komunikat o kilku punktach poboru,
     a „Dalej” jest zatrzymane; po usunięciu pliku kreator znów działa;
   - otwórz odnośnik w zgodzie (`/prywatnosc/`) i odnośnik „jak go pobrać z eLicznika” w kroku 1
     (`/jak-pobrac-dane-z-elicznika/`): każdy otwiera się w nowej karcie (na serwerze lokalnym
     ze stroną błędu 404), a dane na stronie narzędzia zostają.
7. Zatrzymaj serwer (Ctrl+C) i usuń pliki próbne z telefonu.

Układ kroku 6 z polem adresu i ekranu po wysłaniu na wąskim ekranie da się obejrzeć na komputerze:
serwer z opcją `--zgloszenie`, strona pod `http://127.0.0.1:8000/` w trybie urządzenia narzędzi
przeglądarki. Prawdziwą wysyłkę z telefonu sprawdza się na stronie z HTTPS.

## Jak sprawdzić kopię na stronie

Katalog `app/` trafia na stronę bez zmian. Plik `app/SHA256SUMS` zawiera skrót SHA-256 każdego
pliku z `app/` w formacie programu `sha256sum` (linie posortowane po bajtach ścieżki w UTF-8).

```sh
cd app
sha256sum -c SHA256SUMS          # każdy plik: OK
sha256sum SHA256SUMS             # suma kontrolna kopii
```

To samo bez `sha256sum` (na przykład na macOS):

```sh
node narzedzia/sumy.mjs --sprawdz   # sprawdza listę i podaje sumę kontrolną kopii
```

Suma kontrolna kopii to skrót samego pliku `SHA256SUMS`. Opis każdego wydania na GitHubie podaje
tę sumę; ta sama suma musi wyjść z plików pobranych ze strony. Po każdej zmianie w `app/` listę
trzeba odświeżyć poleceniem `node narzedzia/sumy.mjs --zapisz`; CI sprawdza, że jest aktualna.

## Licencja

MIT, plik `LICENSE`.
