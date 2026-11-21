# Zasady pracy w repozytorium prosumentlab-przygotowanie-pliku

Repozytorium jest publiczne. Zawiera narzędzie do przygotowania pliku godzinowego z licznika przed
wysłaniem go do ProsumentLab. Specyfikacja narzędzia jest poza tym repozytorium; tutaj trafia
tylko kod, który ją realizuje, i dane syntetyczne do testów.

## Zasady twarde

1. **Tylko dane syntetyczne.** Dane testowe powstają wyłącznie w `narzedzia/generator.mjs`.
   Do repozytorium nie trafia żaden prawdziwy plik z licznika, faktura, wartość przepisana
   z faktury ani dane właściciela lub klientów: w testach, przykładach, komentarzach, opisach
   commitów i wydań. Kwoty i ceny w przykładach są zmyślone (np. „12,34”, „0,51234”).
2. **Jedyne ciągi 12 i więcej cyfr** to fikcyjne numery PPE `590000000000000010`
   i `590000000000000021`. Mają celowo błędną cyfrę kontrolną GS1, więc nie należą do żadnego
   punktu poboru. Fikcyjne numery płatnika: `10000001` i `10000002`. Ciąg od 8 do 11 cyfr,
   przy którym nie stoi litera ani cyfra, może być tylko jednym z wyjątków wymienionych z osobna
   w obu strażach (dziś dwa numery płatnika i ciąg kontrolny CRC-32 `123456789`); w nowych
   testach używamy tych wartości albo ciągów budowanych w kodzie, zamiast dopisywać wyjątki.
   Pilnują tego `test/repo.test.mjs` i `.gitleaks.toml`.
3. **Bez zależności od innych repozytoriów** i bez ich ścieżek w plikach. Komentarz w kodzie
   tłumaczy regułę wprost, zamiast odsyłać do dokumentu spoza repozytorium.
4. **Czysty JavaScript w modułach ES.** Bez bibliotek, bez npm, bez kroku budowania. Narzędzie
   w przeglądarce nie korzysta z sieci.
5. **Liczby z tekstu.** Kwoty i ceny są tekstem, energia i grosze liczbami całkowitymi. W `app/lib/`
   nie ma `Number(`, `parseFloat` ani `parseInt`. Znaczniki czasu są rozbierane z tekstu, bez
   `new Date(tekst)` i `Date.parse`; wynik nie zależy od strefy czasowej.
6. **Narzędzie niczego nie wysyła i niczego nie zapisuje w przeglądarce** (`localStorage`,
   `sessionStorage`, `IndexedDB`, ciasteczka). Test statyczny odrzuca zabronione wywołania w `app/`.
7. **Teksty dla klienta są tylko w `app/teksty.js`.** W tekstach dla klienta piszemy „narzędzie
   do przygotowania pliku”, nigdy „anonimizator” ani „anonimizacja”. Nowy albo zmieniony tekst
   zatwierdza właściciel przed commitem.
8. **Po każdej zmianie w `app/`** trzeba odświeżyć sumy: `node narzedzia/sumy.mjs --zapisz`.
9. **Commit dopiero po przeglądzie zmian.** Agent, który wykonuje zlecenie, commita nie robi:
   oddaje raport, a commit robi prowadzący sesję po przeczytaniu zmian i uruchomieniu testów.
   **Push, tag i wydanie tylko po wyraźnej zgodzie właściciela na tę operację**, po uruchomieniu
   gitleaks na całej historii i przeglądzie plików. Historii nie przepisujemy, tagów nie przesuwamy.

## Jak pracować

- Testy: `node --test "test/**/*.test.mjs"` (wersja Node jak w `.github/workflows/ci.yml`).
- Strona lokalnie: `node narzedzia/serwer.mjs`, bo moduły ES nie działają z `file://`.
- Moduły w `app/lib/` nie dotykają DOM, więc te same funkcje działają w przeglądarce i w Node.
- Test powstaje przed kodem, który sprawdza.
