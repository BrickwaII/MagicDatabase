import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authOptions } from "@/lib/auth";
import type { Db } from "@/lib/db";
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
