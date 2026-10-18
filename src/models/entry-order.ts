import { EntryStorage } from "./storage";

// Case-insensitive, with digits compared as numbers ("Site 2" before "Site 10")
const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

// An issuer may end in "::host" for site matching. The popup hides that part,
// so sort on the visible name only.
function compareEntryNames(a: OTPEntryInterface, b: OTPEntryInterface) {
  const issuerA = a.issuer.split("::")[0];
  const issuerB = b.issuer.split("::")[0];

  return (
    nameCollator.compare(issuerA, issuerB) ||
    nameCollator.compare(a.account, b.account)
  );
}

// Keeps the stored order alphabetical, so the popup, exports and anything
// else reading storage agree on it. Sorts the given array in place and saves
// only when an entry moved. Locked entries have no names to sort by until
// they are decrypted (their secret is null), so a list with any of them is
// left alone.
export async function storeEntriesSorted(entries: OTPEntryInterface[]) {
  if (entries.some((entry) => entry.secret === null)) {
    return;
  }

  entries.sort(compareEntryNames);

  let isOrderChanged = false;
  entries.forEach((entry, position) => {
    if (entry.index !== position) {
      entry.index = position;
      isOrderChanged = true;
    }
  });

  if (isOrderChanged) {
    await EntryStorage.set(entries);
  }
}
