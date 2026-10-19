import { LocalStore } from "./local";
import { SheetsStore } from "./sheets";
import type { Store } from "./types";

export type { Store, StoredRow } from "./types";

let store: Store | undefined;

export function getStore(): Store {
  if (store) return store;
  const backend = process.env.STORAGE_BACKEND ?? (process.env.SPREADSHEET_ID ? "sheets" : "local");
  if (backend === "sheets") {
    const id = process.env.SPREADSHEET_ID;
    const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!id || !key) throw new Error("SPREADSHEET_ID and GOOGLE_SERVICE_ACCOUNT_KEY must be set");
    store = new SheetsStore(id, key);
  } else {
    store = new LocalStore();
  }
  return store;
}

/** For tests. */
export function setStore(s: Store | undefined) {
  store = s;
}
