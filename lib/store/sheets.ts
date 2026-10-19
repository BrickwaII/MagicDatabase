import { GoogleAuth } from "google-auth-library";
import { TABS, type RawRow, type TabName } from "../schema";
import type { Store, StoredRow } from "./types";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

export function columnLetter(n: number): string {
  // 0 -> A, 25 -> Z, 26 -> AA
  let s = "";
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) {
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  }
  return s;
}

export function parseServiceAccountKey(raw: string): { client_email: string; private_key: string } {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const key = JSON.parse(text);
  if (!key.client_email || !key.private_key) throw new Error("Service account key is missing fields");
  return key;
}

/**
 * Google Sheets backend. Only the server holds the service-account key; the
 * spreadsheet is shared with that account as Editor and with nobody else.
 */
export class SheetsStore implements Store {
  private auth: GoogleAuth;
  private headers = new Map<TabName, string[]>();
  private sheetIds = new Map<string, number>();

  constructor(
    private spreadsheetId: string,
    serviceAccountKey: string,
    scopes = ["https://www.googleapis.com/auth/spreadsheets"],
  ) {
    this.auth = new GoogleAuth({ credentials: parseServiceAccountKey(serviceAccountKey), scopes });
  }

  private async call<T>(method: string, url: string, data?: unknown): Promise<T> {
    const client = await this.auth.getClient();
    const res = await client.request<T>({ method: method as "GET", url, data, retry: true });
    return res.data;
  }

  private url(suffix: string) {
    return `${API}/${this.spreadsheetId}${suffix}`;
  }

  private range(tab: string, a1?: string) {
    return encodeURIComponent(a1 ? `'${tab}'!${a1}` : `'${tab}'`);
  }

  /** Read every cell of a tab as strings (header row first). */
  async readValues(tab: string): Promise<string[][]> {
    const res = await this.call<{ values?: unknown[][] }>(
      "GET",
      this.url(`/values/${this.range(tab)}?valueRenderOption=FORMATTED_VALUE`),
    );
    return (res.values ?? []).map((row) => row.map((c) => (c === null || c === undefined ? "" : String(c))));
  }

  private async header(tab: TabName): Promise<string[]> {
    const cached = this.headers.get(tab);
    if (cached) return cached;
    const values = await this.call<{ values?: string[][] }>("GET", this.url(`/values/${this.range(tab, "1:1")}`));
    const header = values.values?.[0]?.map((h) => h.trim()) ?? [];
    if (header.length === 0) throw new Error(`Tab ${tab} has no header row; run npm run setup-sheet`);
    const missing = TABS[tab].filter((c) => !header.includes(c));
    const full = [...header, ...missing];
    if (missing.length) {
      // Add new schema columns to the right instead of failing.
      await this.call("PUT", this.url(`/values/${this.range(tab, "1:1")}?valueInputOption=RAW`), {
        values: [full],
      });
    }
    this.headers.set(tab, full);
    return full;
  }

  private toCells(header: string[], row: RawRow) {
    return header.map((h) => row[h] ?? "");
  }

  async getRows(tab: TabName): Promise<StoredRow[]> {
    const values = await this.readValues(tab);
    if (values.length === 0) return [];
    const header = values[0].map((h) => h.trim());
    this.headers.set(tab, header);
    return values
      .slice(1)
      .map((cells, index) => {
        const data: RawRow = {};
        header.forEach((h, i) => (data[h] = cells[i] ?? ""));
        return { index, data };
      })
      .filter((r) => Object.values(r.data).some((v) => v !== ""));
  }

  async appendRows(tab: TabName, rows: RawRow[]) {
    if (rows.length === 0) return;
    const header = await this.header(tab);
    await this.call(
      "POST",
      this.url(`/values/${this.range(tab, "A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`),
      { values: rows.map((r) => this.toCells(header, r)) },
    );
  }

  async updateRow(tab: TabName, index: number, row: RawRow) {
    const header = await this.header(tab);
    const n = index + 2;
    const a1 = `A${n}:${columnLetter(header.length - 1)}${n}`;
    await this.call("PUT", this.url(`/values/${this.range(tab, a1)}?valueInputOption=RAW`), {
      values: [this.toCells(header, row)],
    });
  }

  private async sheetId(tab: string): Promise<number> {
    if (!this.sheetIds.has(tab)) {
      const meta = await this.call<{ sheets: { properties: { title: string; sheetId: number } }[] }>(
        "GET",
        this.url("?fields=sheets.properties(title,sheetId)"),
      );
      for (const s of meta.sheets) this.sheetIds.set(s.properties.title, s.properties.sheetId);
    }
    const id = this.sheetIds.get(tab);
    if (id === undefined) throw new Error(`No tab named ${tab}`);
    return id;
  }

  async deleteRows(tab: TabName, indices: number[]) {
    if (indices.length === 0) return;
    const sheetId = await this.sheetId(tab);
    // Delete bottom-up so earlier deletes don't shift later ones.
    const requests = [...new Set(indices)]
      .sort((a, b) => b - a)
      .map((i) => ({
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: i + 1, endIndex: i + 2 },
        },
      }));
    await this.call("POST", this.url(":batchUpdate"), { requests });
  }

  async replaceAll(tab: TabName, rows: RawRow[]) {
    const header = [...TABS[tab]];
    await this.call("POST", this.url(`/values/${this.range(tab)}:clear`), {});
    await this.call("PUT", this.url(`/values/${this.range(tab, "A1")}?valueInputOption=RAW`), {
      values: [header, ...rows.map((r) => this.toCells(header, r))],
    });
    this.headers.set(tab, header);
  }

  async ensureTabs() {
    const meta = await this.call<{ sheets: { properties: { title: string } }[] }>(
      "GET",
      this.url("?fields=sheets.properties.title"),
    );
    const existing = new Set(meta.sheets.map((s) => s.properties.title));
    const missing = (Object.keys(TABS) as TabName[]).filter((t) => !existing.has(t));
    if (missing.length) {
      await this.call("POST", this.url(":batchUpdate"), {
        requests: missing.map((title) => ({
          addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } },
        })),
      });
    }
    for (const tab of Object.keys(TABS) as TabName[]) {
      if (missing.includes(tab)) {
        await this.call("PUT", this.url(`/values/${this.range(tab, "A1")}?valueInputOption=RAW`), {
          values: [[...TABS[tab]]],
        });
      } else {
        await this.header(tab); // adds any new columns
      }
    }
    this.sheetIds.clear();
  }
}
