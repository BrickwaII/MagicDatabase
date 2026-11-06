import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authOptions } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { playerOptions } from "@/lib/schema";
import { safeCallbackPath } from "@/lib/util";
import { insertPlayers, resetDb, useTestDb } from "./helpers/db";

let db: Db;
beforeAll(async () => {
  db = await useTestDb();
});
beforeEach(async () => {
  const gid = await resetDb(db);
  await insertPlayers(db, gid, [
    { player_id: "sam", display_name: "Sam", email: "sam@example.com", role: "player", active: true },
    { player_id: "old", display_name: "Old", email: "old@example.com", role: "player", active: false },
  ]);
});

const signIn = (email: string, profile?: Record<string, unknown>) =>
  authOptions.callbacks!.signIn!({
    user: { id: "x", email },
    account: { provider: "google", type: "oauth", providerAccountId: "1" },
    profile: profile as never,
  } as never);

describe("playerOptions", () => {
  it("gives client components names and ids only, never emails or roles", () => {
    const out = playerOptions([{ player_id: "sam", display_name: "Sam", email: "sam@example.com", role: "admin", active: true }]);
    expect(out).toEqual([{ player_id: "sam", display_name: "Sam" }]);
  });
});

describe("safeCallbackPath", () => {
  it("keeps same-site paths from the middleware", () => {
    expect(safeCallbackPath("/games/g_123")).toBe("/games/g_123");
    expect(safeCallbackPath("/stats?view=decks")).toBe("/stats?view=decks");
    expect(safeCallbackPath(undefined)).toBe("/");
  });

  it("drops anything that could leave the site or loop", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/login", "/api/auth/signout"]) {
      expect(safeCallbackPath(bad)).toBe("/");
    }
    expect(safeCallbackPath(["//evil", "/games"])).toBe("/");
  });
});

describe("sign-in invite list", () => {
  it("lets in an invited, verified Google email (case-insensitive)", async () => {
    expect(await signIn("Sam@Example.com", { email_verified: true })).toBe(true);
  });

  it("refuses emails not on the list and inactive players", async () => {
    expect(await signIn("kim@example.com", { email_verified: true })).toBe("/login?error=NotInvited");
    expect(await signIn("old@example.com", { email_verified: true })).toBe("/login?error=NotInvited");
  });

  it("refuses an invited address that Google says is unverified", async () => {
    expect(await signIn("sam@example.com", { email_verified: false })).toBe("/login?error=NotInvited");
    expect(await signIn("sam@example.com", {})).toBe("/login?error=NotInvited");
  });
});
