# prosumentlab-przygotowanie-pliku

Narzędzie do przygotowania pliku godzinowego z licznika przed wysłaniem go do ProsumentLab.
Działa w przeglądarce i niczego nie wysyła.

## Co robi

- Przyjmuje jeden albo kilka plików godzinowych z eLicznika Taurona (CSV).
- Usuwa z nich numer punktu poboru (PPE) i numer płatnika. Wartości tych numerów nie są nigdzie
  pokazywane ani zapisywane, także jako skrót.
- Sprawdza, czy w wyniku nie zostało nic, co wygląda na numer PPE, długi numer albo adres e-mail.
  Jeśli zostało, nie tworzy pliku ZIP.
- Liczy, ile pełnych miesięcy obejmują dane, i porównuje pliki, które na siebie zachodzą.
- Zbiera liczby i nazwy przepisane z faktury oraz nieobowiązkowe odpowiedzi o instalacji.
- Pokazuje podgląd wszystkiego, co trafi do pliku ZIP, i zapisuje ZIP na urządzeniu.
  Plik wysyła się samodzielnie, mailem.

Usunięcie dwóch numerów nie czyni danych anonimowymi. W pliku ZIP zostaje godzinowy profil
poboru i oddania energii, a wiadomość, którą wysyłasz, łączy go z Twoim adresem e-mail.
Dlatego o tym, co dzieje się z plikiem po wysłaniu, mówi informacja o przetwarzaniu danych.

Wszystko dzieje się w pamięci przeglądarki. Narzędzie nie używa `fetch`, `localStorage` ani
ciasteczek; strona ma politykę treści z `connect-src 'none'`.

## Narzędzie a AI

- Kod tego narzędzia powstaje z pomocą asystenta AI (Claude). Autor przegląda zmiany przed ich
  przyjęciem, a działanie sprawdzają testy z tego repozytorium.
- Narzędzie działa w Twojej przeglądarce i niczego nie wysyła: ani do nas, ani do żadnej usługi AI.
  Możesz to sprawdzić w kodzie albo odłączyć sieć po otwarciu strony.
- Co dzieje się z plikiem ZIP, który wyślesz nam mailem, opisuje informacja o przetwarzaniu
  danych: https://prosumentlab.pl/prywatnosc/ (punkt 2).

## Jak uruchomić lokalnie

Potrzebny jest Node (wersja z `.github/workflows/ci.yml`). Bez npm i bez instalowania czegokolwiek.

```sh
node narzedzia/serwer.mjs        # strona pod http://127.0.0.1:8000/
node --test "test/**/*.test.mjs" # testy
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

## Nagłówki serwera

Katalog `app/` może podawać dowolny serwer plików, ale przy każdej odpowiedzi musi wysyłać cztery
nagłówki. Polityka treści w znaczniku `<meta>` strony nie obejmuje `frame-ancestors`, dlatego
nagłówek `Content-Security-Policy` ma tę samą politykę co `index.html` i dodatkowo
`frame-ancestors 'none'`:

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'
Cross-Origin-Opener-Policy: same-origin
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

Lokalny serwer (`narzedzia/serwer.mjs`) wysyła te same nagłówki; `test/serwer.test.mjs` pilnuje,
żeby lista tutaj zgadzała się z serwerem.

## Próba w przeglądarce na komputerze

`narzedzia/proba-przegladarki.mjs` uruchamia Chrome albo Chromium bez okna i przechodzi cały
przepływ na plikach z generatora: wybór plików, zakres, formularz, podgląd, zapis ZIP-a, odnośnik
do wiadomości i blokady, na szerokości 1280 px i 390 px. Sprawdza też, że strona nie wysyła żadnego
zapytania poza własne pliki, nie pisze błędów w konsoli i niczego nie zostawia w przeglądarce.
Nie należy do `node --test` ani do CI, bo wymaga zainstalowanej przeglądarki.

```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node narzedzia/proba-przegladarki.mjs
node narzedzia/proba-przegladarki.mjs --chrome /usr/bin/chromium --zostaw   # --zostaw: zrzuty ekranu
```

## Odbiór na telefonie

Telefon nie sięgnie do `127.0.0.1` komputera, więc do odbioru serwer trzeba wystawić w sieci
domowej. Używaj wyłącznie plików z generatora.

1. Przygotuj pliki z generatora, na przykład cały rok i drugi plik z dwoma punktami poboru do
   sprawdzenia blokady:

   ```sh
   mkdir -p proby
   node narzedzia/generator.mjs --od 2025-01-01 --do 2025-12-31 --wyjscie proby/rok_2025.csv
   node narzedzia/generator.mjs --od 2026-01-01 --do 2026-01-31 --drugi-ppe --wyjscie proby/dwa_punkty.csv
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
6. Przejdź cały przepływ:
   - przed dodaniem pliku sekcja zakresu mówi, że zakres pojawi się po dodaniu pliku;
   - dodaj `rok_2025.csv`: plakietka „Przyjęty”, zakres „12 pełnych miesięcy”;
   - w danych z faktury wybierz najpierw sposób rozliczenia energii oddanej; wybór „system
     opustów” chowa pozostałe pola, a powrót do net-billingu pokazuje je z wpisanymi wartościami;
   - wypełnij pozostałe pola faktury dowolnymi zmyślonymi liczbami (na przykład 12,34): sprzedawca,
     grupa taryfowa, okres, pole wyboru „To jest faktura korygująca” (zaznacz i odznacz), rodzaj
     ceny i cenę; przy cenie dynamicznej jest jedno pole ceny, bez stref; rozwiń „Co to znaczy?”
     przy kilku polach i „Opłaty stałe (nieobowiązkowe)”;
   - zaznacz odpowiedzi o instalacji, w tym miesiąc i rok magazynu, i zgodę;
   - sprawdź podgląd: pliki z ZIP-a i tabela miesięcy są zwinięte, rozwiń kilka z nich;
     rozwinięte zostają po zmianie pola. Potem dotknij „Zapisz plik ZIP”; plik ma nazwę
     `prosumentlab_<numer>.zip` z numerem ze strony (iOS: aplikacja Pliki, Pobrane;
     Android: Pobrane). Chrome może przy zapisie ostrzegać
     o pobieraniu pliku bez HTTPS; wtedy wybierz „Zachowaj”;
   - przycisk „Wyślij plik ZIP” pokazuje się tylko na stronie z HTTPS, więc w odbiorze przez sieć
     domową go nie ma;
   - dotknij „Napisz wiadomość”: aplikacja poczty otwiera się z adresem raporty@prosumentlab.pl,
     tematem z numerem zgłoszenia i treścią z przypomnieniem o załączniku; plik nie jest
     dołączony. **Nie wysyłaj tej wiadomości**, zamknij ją bez wysyłania;
   - dodaj `dwa_punkty.csv`: plik dostaje komunikat o kilku punktach poboru, zapis jest
     zablokowany; po usunięciu pliku zapis znów działa;
   - otwórz odnośnik w zgodzie i odnośnik „jak go pobrać z eLicznika” w kroku 1: każdy otwiera
     się w nowej karcie (na serwerze lokalnym ze stroną błędu 404), a dane na stronie narzędzia
     zostają.
7. Zatrzymaj serwer (Ctrl+C) i usuń pliki próbne z telefonu.

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
