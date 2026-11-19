// Numer zgłoszenia: 8 znaków z alfabetu 32 znaków bez I, L, O i U (łatwo je pomylić),
// zapis XXXX-XXXX. Każdy znak powstaje z jednego losowego bajtu jako `bajt & 31`. 256 dzieli
// się przez 32, więc każdy znak jest jednakowo prawdopodobny. 40 bitów losowości wystarcza,
// żeby przy setkach zgłoszeń dwa numery praktycznie się nie powtórzyły.

export const ALFABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function numerZBajtow(bajty) {
  if (!bajty || bajty.length !== 8) throw new Error("numer wymaga 8 bajtów");
  let znaki = "";
  for (const b of bajty) znaki += ALFABET[b & 31];
  return `${znaki.slice(0, 4)}-${znaki.slice(4)}`;
}

// `losuj` wypełnia tablicę bajtów; domyślnie crypto.getRandomValues z przeglądarki albo Node.
export function losowyNumer(losuj = (tablica) => globalThis.crypto.getRandomValues(tablica)) {
  const bajty = new Uint8Array(8);
  losuj(bajty);
  return numerZBajtow(bajty);
}
