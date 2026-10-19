import fs from "node:fs";
import path from "node:path";
import { TABS, type RawRow, type TabName } from "../schema";
import type { Store, StoredRow } from "./types";

type Db = Partial<Record<TabName, RawRow[]>>;

/**
 * JSON-file store for local development and tests. Mirrors the Sheets
 * backend's behaviour (string cells, header-named columns).
 */
export class LocalStore implements Store {
  constructor(private file = path.join(process.cwd(), ".data", "db.json")) {}

  private load(): Db {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as Db;
    } catch {
      return {};
    }
  }

  private save(db: Db) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, this.file);
  }

  private clean(tab: TabName, row: RawRow): RawRow {
    const out: RawRow = {};
    for (const col of TABS[tab]) out[col] = row[col] ?? "";
    return out;
  }

  async getRows(tab: TabName): Promise<StoredRow[]> {
    return (this.load()[tab] ?? []).map((data, index) => ({ index, data: { ...data } }));
  }

  async appendRows(tab: TabName, rows: RawRow[]) {
    const db = this.load();
    db[tab] = [...(db[tab] ?? []), ...rows.map((r) => this.clean(tab, r))];
    this.save(db);
  }

  async updateRow(tab: TabName, index: number, row: RawRow) {
    const db = this.load();
    const rows = db[tab] ?? [];
    if (index < 0 || index >= rows.length) throw new Error(`${tab}: no row ${index}`);
    rows[index] = this.clean(tab, row);
    db[tab] = rows;
    this.save(db);
  }

  async deleteRows(tab: TabName, indices: number[]) {
    const db = this.load();
    const drop = new Set(indices);
    db[tab] = (db[tab] ?? []).filter((_, i) => !drop.has(i));
    this.save(db);
  }

  async replaceAll(tab: TabName, rows: RawRow[]) {
    const db = this.load();
    db[tab] = rows.map((r) => this.clean(tab, r));
    this.save(db);
  }

  async ensureTabs() {
    const db = this.load();
    for (const tab of Object.keys(TABS) as TabName[]) db[tab] ??= [];
    this.save(db);
  }
}
