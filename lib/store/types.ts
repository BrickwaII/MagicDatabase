import type { RawRow, TabName } from "../schema";

export interface StoredRow {
  /** 0-based position among data rows (header excluded). */
  index: number;
  data: RawRow;
}

/**
 * Row-level access to the spreadsheet tabs. Indices are only valid until the
 * next delete on the same tab, so callers re-read before deleting.
 */
export interface Store {
  getRows(tab: TabName): Promise<StoredRow[]>;
  appendRows(tab: TabName, rows: RawRow[]): Promise<void>;
  updateRow(tab: TabName, index: number, row: RawRow): Promise<void>;
  deleteRows(tab: TabName, indices: number[]): Promise<void>;
  /** Overwrite a whole tab (used by migration). */
  replaceAll(tab: TabName, rows: RawRow[]): Promise<void>;
  /** Create any missing tabs and write header rows. */
  ensureTabs(): Promise<void>;
}
