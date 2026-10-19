import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { migrate, parseDate, splitDeckCell } from "@/lib/migrate";

describe("deck cells", () => {
  it("splits emoji color identity from the nickname", () => {
    expect(splitDeckCell("🟥🟩⬜Tifa")).toEqual({ colors: "WRG", name: "Tifa" });
    expect(splitDeckCell("🟦⬛ Kilo")).toEqual({ colors: "UB", name: "Kilo" });
    expect(splitDeckCell("Rainbow Dash")).toEqual({ colors: "", name: "Rainbow Dash" });
  });
  it("parses dates", () => {
    expect(parseDate("1/3/2026")).toBe("2026-01-03");
    expect(parseDate("2026-01-03")).toBe("2026-01-03");
    expect(parseDate("46025")).toBe("2026-01-03");
    expect(parseDate("nope")).toBeNull();
  });
});

describe("migrate", () => {
  const decks = parseCsv(`Henry,Sam,Alex
🟥🟩⬜Tifa,⬜🟦Tidus,🟦🟩Kilo
⬜🟦Tidus,⬜🟩Emmara,
`);
  const games = parseCsv(`Date,Game #,Seat Order,Player,Deck,Winner,Bracket,Win Condition,Additional Rules,Notes
1/3/2026,1,1,Henry,🟥🟩⬜Tifa,TRUE,"2, 3",Combat,Planeschase,fun one
,,2,Sam,⬜🟦Tidus,FALSE,,,,
,,3,Alex,🟦🟩Kilo,FALSE,,,,
,,4,RANDOM,,FALSE,,,,
,2,1,Sam,⬜🟩Emmara,FALSE,3,Combo,,
,,2,Henry,⬜🟦Tidus,FALSE,,,,
,,3,Alex,🟦🟩Kilo,TRUE,,,,
1/4/2026,1,2,Alex,🟦🟩Kilo,FALSE,4,Combat,,
,,1,Sam,⬜🟦Tidus,TRUE,,,,
,,3,Henry,🟥🟩⬜Tifa,FALSE,,,,
`);
  const data = parseCsv(`Players,Win Conditions,Additional Rules
Henry,Combat,Planechase
Sam,Combo,
Alex,,
`);
  const res = migrate({ games, decks, data });

  it("builds players, decks keyed by owner, and lookups", () => {
    expect(res.players.map((p) => p.player_id)).toEqual(["henry", "sam", "alex"]);
    const tidus = res.decks.filter((d) => d.name === "Tidus");
    expect(tidus.map((d) => d.owner_player_id).sort()).toEqual(["henry", "sam"]);
    expect(res.rules).toEqual([{ id: "planechase", name: "Planechase" }]);
  });

  it("fills down merged cells and groups rows into games", () => {
    expect(res.games).toHaveLength(3);
    const [g1, g2, g3] = res.games;
    expect(g1).toMatchObject({ date: "2026-01-03", day_game_no: 1, brackets: ["2", "3"], additional_rules: ["planechase"], status: "approved", result: "won" });
    expect(g2).toMatchObject({ date: "2026-01-03", day_game_no: 2, win_conditions: ["combo"] });
    expect(g3).toMatchObject({ date: "2026-01-04", day_game_no: 1 });
  });

  it("orders seats, maps guests and winners, and resolves each player's own deck", () => {
    const s1 = res.seats.filter((s) => s.game_id === res.games[0].game_id);
    expect(s1).toHaveLength(4);
    expect(s1[3]).toMatchObject({ player_id: "RANDOM", deck_id: "" });
    expect(s1[0]).toMatchObject({ player_id: "henry", is_winner: true });
    expect(s1[1].deck_id).toBe(res.decks.find((d) => d.owner_player_id === "sam" && d.name === "Tidus")!.deck_id);
    const s3 = res.seats.filter((s) => s.game_id === res.games[2].game_id);
    expect(s3.map((s) => s.player_id)).toEqual(["sam", "alex", "henry"]);
    expect(s3[0].is_winner).toBe(true);
  });
});
