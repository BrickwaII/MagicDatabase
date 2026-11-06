// Read-only access to the old "Magic Records - 2026" Google Sheet, used only by
// scripts/migrate.ts. The app itself never talks to Google Sheets.
import { GoogleAuth } from "google-auth-library";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

export function parseServiceAccountKey(raw: string): { client_email: string; private_key: string } {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const key = JSON.parse(text);
  if (!key.client_email || !key.private_key) throw new Error("Service account key is missing fields");
  return key;
}

export class OldSheetReader {
  private auth: GoogleAuth;

  constructor(
    private spreadsheetId: string,
    serviceAccountKey: string,
  ) {
    this.auth = new GoogleAuth({
      credentials: parseServiceAccountKey(serviceAccountKey),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
  }

  /** Read every cell of a tab as strings (header row first). */
  async readValues(tab: string): Promise<string[][]> {
    const client = await this.auth.getClient();
    const range = encodeURIComponent(`'${tab}'`);
    const res = await client.request<{ values?: unknown[][] }>({
      method: "GET",
      url: `${API}/${this.spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
      retry: true,
    });
    return (res.data.values ?? []).map((row) => row.map((c) => (c === null || c === undefined ? "" : String(c))));
  }
}
