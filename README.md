# prosumentlab-anonimizator

Narzędzie do przygotowania pliku godzinowego z licznika przed wysłaniem go do ProsumentLab.
Działa w przeglądarce i niczego nie wysyła.

## Co robi

- Przyjmuje jeden albo kilka plików godzinowych z eLicznika Taurona (CSV).
- Usuwa z nich numer punktu poboru (PPE) i numer płatnika. Wartości tych numerów nie są nigdzie
  pokazywane ani zapisywane, także jako skrót.
- Sprawdza, czy w wyniku nie zostało nic, co wygląda na numer PPE, długi numer albo adres e-mail.
  Jeśli zostało, nie tworzy pliku ZIP.
- Liczy, ile pełnych miesięcy obejmują dane, i porównuje pliki, które na siebie zachodzą.
- Zbiera kilkanaście liczb przepisanych z faktury i nieobowiązkowe odpowiedzi o instalacji.
- Pokazuje podgląd wszystkiego, co trafi do pliku ZIP, i zapisuje ZIP na urządzeniu.
  Plik wysyła się samodzielnie, mailem.

Wszystko dzieje się w pamięci przeglądarki. Narzędzie nie używa `fetch`, `localStorage` ani
ciasteczek; strona ma politykę treści z `connect-src 'none'`.

## Jak uruchomić lokalnie

Potrzebny jest Node (wersja z `.github/workflows/ci.yml`). Bez npm i bez instalowania czegokolwiek.

```sh
node narzedzia/serwer.mjs        # strona pod http://127.0.0.1:8000/
node --test "test/**/*.test.mjs" # testy
```

Moduły ES nie działają z `file://`, dlatego potrzebny jest lokalny serwer plików.

Dane do prób tworzy generator danych syntetycznych:

```sh
node narzedzia/generator.mjs --help
```

## Jak sprawdzić kopię na stronie

Katalog `app/` trafia na stronę bez zmian. Plik `app/SHA256SUMS` zawiera skrót SHA-256 każdego
pliku z `app/` w formacie programu `sha256sum`.

```sh
cd app
sha256sum -c SHA256SUMS          # każdy plik: OK
sha256sum SHA256SUMS             # suma kontrolna kopii
```

Suma kontrolna kopii to skrót samego pliku `SHA256SUMS`. Opis każdego wydania na GitHubie podaje
tę sumę; ta sama suma musi wyjść z plików pobranych ze strony.

## Licencja

MIT, plik `LICENSE`.
