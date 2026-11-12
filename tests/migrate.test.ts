import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { detectGamesColumns, migrate, parseDate, parseGuestDeck, splitDeckCell } from "@/lib/migrate";

describe("deck cells", () => {
  it("splits emoji color identity from the nickname", () => {
    expect(splitDeckCell("🟥🟩⬜Tifa")).toEqual({ colors: "WRG", name: "Tifa" });
    expect(splitDeckCell("🟦⬛ Kilo")).toEqual({ colors: "UB", name: "Kilo" });
    expect(splitDeckCell("Rainbow Dash")).toEqual({ colors: "", name: "Rainbow Dash" });
  });
  it("splits a guest's deck text on the last \" - \" into deck and name", () => {
    expect(parseGuestDeck("Caesar - Zed")).toEqual({ guest_deck: "Caesar", guest_name: "Zed" });
    expect(parseGuestDeck("  The Jolly Kite Man - Quinn ")).toEqual({ guest_deck: "The Jolly Kite Man", guest_name: "Quinn" });
    expect(parseGuestDeck("Mono-Red - Big - Zed")).toEqual({ guest_deck: "Mono-Red - Big", guest_name: "Zed" });
    // No " - ": all deck. Parentheses are never read as a name; hyphens without spaces don't split.
    expect(parseGuestDeck("Green Goblin (Pickled, lol)")).toEqual({ guest_deck: "Green Goblin (Pickled, lol)", guest_name: "" });
    expect(parseGuestDeck("Niv-Mizzet (Life)")).toEqual({ guest_deck: "Niv-Mizzet (Life)", guest_name: "" });
    expect(parseGuestDeck("")).toEqual({ guest_deck: "", guest_name: "" });
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

// Regression fixtures shaped like the real old sheet (invented names). Each block
// reproduces a quirk found when running the parser against the real data.
describe("migrate: real old-sheet layout", () => {
  const H =
    "Date,#,Players (In Turn Order),Decks,Winner,Bracket(s),Win Condition(s),Additional Rules(s),Notes,Player #,Winner #,DateFilled,Game#Filled,PlayersFilled,WinnerFilled,BracketFilled,RulesFilled,PlayerCountFilled,SeatNumber";
  // Merged cells (Date, #, Winner, Bracket, ...) are blank except on a game's first row.
  // The *Filled helper columns hold fill-down values that must be ignored.
  const games = parseCsv(`${H}
2/7/2026,1,Ana,🟦⬛Quill,Bo,"2, 3",Combo,Last Player Treasure,,3,2,2/7/2026,1,Ana,Bo,"2, 3",Last Player Treasure,3,1
,,Bo,🟥Spark,,,,,,,,2/7/2026,1,Bo,Bo,"2, 3",Last Player Treasure,3,2
,,RANDOM,Some Guest Deck - Zed,,,,,,,,2/7/2026,1,RANDOM,Bo,"2, 3",Last Player Treasure,3,3
2/7/2026,2,RANDOM,Guest A,RANDOM_Seat3,,,,,4,,2/7/2026,2,RANDOM,RANDOM_Seat3,"2, 3",Last Player Treasure,4,1
,,Ana,🟥Spark,,,,,,,,2/7/2026,2,Ana,RANDOM_Seat3,"2, 3",Last Player Treasure,4,2
,,RANDOM,Guest B,,,,,,,,2/7/2026,2,RANDOM,RANDOM_Seat3,"2, 3",Last Player Treasure,4,3
,,Bo,🟦🟥Spark,,,,,,,,2/7/2026,2,Bo,RANDOM_Seat3,"2, 3",Last Player Treasure,4,4
2/8/2026,1,Ana,⬛🟦Quill,Ana,5,,,,2,,2/8/2026,1,Ana,Ana,5,Last Player Treasure,2,1
,,Bo,🟥🟩⬜Quil,,,,,,,,2/8/2026,1,Bo,Ana,5,Last Player Treasure,2,2
,,,Lost Name Deck,,,,,,,,2/8/2026,1,,Ana,5,Last Player Treasure,,
,,,Other Lost Deck,,,,,,,,2/8/2026,1,,Ana,5,Last Player Treasure,,
2/9/2026,1,Bo,🟥Spark,Random_Seat2,,,,,3,,2/9/2026,1,Bo,Random_Seat2,5,Last Player Treasure,3,1
,,RANDOM,Guest C,,,,,,,,2/9/2026,1,RANDOM,Random_Seat2,5,Last Player Treasure,3,2
,,Ana,,,,,,,,,2/9/2026,1,Ana,Random_Seat2,5,Last Player Treasure,3,3
2/9/2026,2,Ana,🟦⬛Quill,,3,,,,3,,2/9/2026,2,Ana,Random_Seat2,3,Last Player Treasure,3,1
,,Bo,🟥Spark,,,,,,,,2/9/2026,2,Bo,Random_Seat2,3,Last Player Treasure,3,2
,,RANDOM,Guest D,,,,,,,,2/9/2026,2,RANDOM,Random_Seat2,3,Last Player Treasure,3,3
2/9/2026,3,,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,,,,
2/9/2026,4,,,,,,,,,,,,,,,,,
`);
  // Column A holds row labels ("Player:" / "Decks:" merged down); one player has
  // two decks with the same nickname in different colors.
  const decks = parseCsv(`Player:,Ana,Bo
Decks:,🟦⬛Quill,🟥Spark
,🟥Spark,🟦🟥Spark
,,🟥🟩⬜Quill
`);
  // DeckDetails rows only annotate decks from the Decks tab (stale/typo rows are
  // ignored); the Data tab has its own Player/Deck/Bracket table.
  const deckDetails = parseCsv(`Player,Deck,Bracket,Notes,,Player (All Pairs),Deck (All Pairs)
Ana,🟦⬛Quill,,,,Ana,🟦⬛Quill
Ana,🟦⬛Quil,,stale typo row,,Ana,🟥Spark
Bo,🟥Sparkk,4,,,Bo,🟥Spark
`);
  const data = parseCsv(`,,,,,,,,
,Players,Win Conditions,Additional Rules,,,Player,Deck,Bracket
,Ana,Combo,Planeschase,,,Ana,🟦⬛Quill,
,Bo,,Last Player Treasure,,,Ana,🟥Spark,2
,RANDOM,,,,,,,
`);
  const seeds = {
    _comment: "x",
    "Quill|UB": "Quill, Test Commander",
    "Spark|UR": [
      { name: "Spark A", oracle_id: "oid-a" },
      { name: "Spark B", oracle_id: "oid-b" },
    ],
    "bo|Quill": [{ name: "Quill Half One" }, { name: "Quill Half Two" }],
  };
  const res = migrate({ games, decks, deckDetails, data }, { commanderSeeds: seeds });
  const seatsOf = (i: number) => res.seats.filter((s) => s.game_id === res.games[i].game_id);
  const deck = (owner: string, name: string, colors: string) =>
    res.decks.find((d) => d.owner_player_id === owner && d.name === name && d.colors === colors)!;

  it("detects the real headers and ignores the *Filled / # helper columns", () => {
    const { cols } = detectGamesColumns(games[0]);
    expect(cols).toMatchObject({ date: 0, gameNo: 1, player: 2, deck: 3, winner: 4, brackets: 5, winConditions: 6, rules: 7, notes: 8 });
    expect(cols.seat).toBeUndefined();
  });

  it("treats Decks column A as labels, not a player or a deck", () => {
    expect(res.players.map((p) => p.player_id)).toEqual(["ana", "bo"]);
    expect(res.decks.some((d) => /decks?:|player:/i.test(d.name))).toBe(false);
  });

  it("keeps same-name decks in different colors apart and merges emoji-order variants", () => {
    expect(res.decks.filter((d) => d.owner_player_id === "bo").map((d) => `${d.name}|${d.colors}`)).toEqual([
      "Spark|R",
      "Spark|UR",
      "Quill|WRG",
    ]);
    expect(seatsOf(1)[3].deck_id).toBe(deck("bo", "Spark", "UR").deck_id);
    expect(seatsOf(2)[0].deck_id).toBe(deck("ana", "Quill", "UB").deck_id); // ⬛🟦 == 🟦⬛
  });

  it("annotates decks from DeckDetails / Data without creating decks from stale rows", () => {
    expect(res.decks).toHaveLength(5);
    expect(deck("ana", "Spark", "R").bracket).toBe("2");
    expect(deck("bo", "Spark", "R").bracket).toBe("4"); // "Sparkk" typo row
  });

  it("reads a typo'd deck cell as the owner's deck", () => {
    expect(seatsOf(2)[1].deck_id).toBe(deck("bo", "Quill", "WRG").deck_id);
    expect(res.warnings.some((w) => w.includes('read as their "Quill"'))).toBe(true);
  });

  it("takes the winner from the merged Winner cell, including RANDOM_Seat<N> guests", () => {
    expect(seatsOf(0).map((s) => s.is_winner)).toEqual([false, true, false]);
    expect(seatsOf(1).map((s) => [s.player_id, s.is_winner])).toEqual([
      ["RANDOM", false],
      ["ana", false],
      ["RANDOM", true],
      ["bo", false],
    ]);
    expect(seatsOf(3).map((s) => s.is_winner)).toEqual([false, true, false]); // Random_Seat2
  });

  it("imports deck-only rows as guest seats", () => {
    expect(seatsOf(2).map((s) => s.player_id)).toEqual(["ana", "bo", "RANDOM", "RANDOM"]);
  });

  it("keeps a named player's seat without a deck", () => {
    expect(seatsOf(3)[2]).toMatchObject({ player_id: "ana", deck_id: "" });
    expect(res.warnings.some((w) => w.includes("Ana has no deck recorded"))).toBe(true);
  });

  it("imports a game with no winner as unfinished instead of crediting the previous winner", () => {
    expect(res.games[4]).toMatchObject({ date: "2026-02-09", result: "unfinished" });
    expect(seatsOf(4).every((s) => !s.is_winner)).toBe(true);
    expect(res.games.slice(0, 4).every((g) => g.result === "won")).toBe(true);
  });

  it("skips pre-numbered empty game slots with one warning", () => {
    expect(res.games).toHaveLength(5);
    expect(res.warnings.filter((w) => w.includes("game slot"))).toEqual([
      "2 game slot(s) with no players skipped: 2026-02-09 #3, 2026-02-09 #4.",
    ]);
  });

  it("imports a blank bracket as no bracket and doesn't carry rules forward (both opt-in)", () => {
    expect(res.games.map((g) => g.brackets.join("+"))).toEqual(["2+3", "", "5", "", "3"]);
    expect(res.games.map((g) => g.additional_rules.length)).toEqual([1, 0, 0, 0, 0]);
    const sticky = migrate({ games, decks }, { stickyBrackets: true, stickyRules: true });
    expect(sticky.games.map((g) => g.brackets.join("+"))).toEqual(["2+3", "2+3", "5", "5", "3"]);
    expect(sticky.games.every((g) => g.additional_rules.length === 1)).toBe(true);
  });

  it("stores guests' deck text on the guest seat, not in the notes", () => {
    expect(res.games.map((g) => g.notes)).toEqual(["", "", "", "", ""]);
    const guests = res.seats.filter((s) => s.player_id === "RANDOM");
    expect(guests.map((s) => [s.guest_deck, s.guest_name])).toEqual([
      ["Some Guest Deck", "Zed"],
      ["Guest A", ""],
      ["Guest B", ""],
      ["Lost Name Deck", ""], // deck-only rows are guests too
      ["Other Lost Deck", ""],
      ["Guest C", ""],
      ["Guest D", ""],
    ]);
    expect(guests.every((s) => s.deck_id === "" && s.guest_added_by === "")).toBe(true);
    expect(res.seats.filter((s) => s.player_id !== "RANDOM").every((s) => !s.guest_name && !s.guest_deck)).toBe(true);
  });

  it("applies commander seeds by owner|name or name|colors, with partner pairs", () => {
    const cmds = (d: { deck_id: string }) => res.deckCommanders.filter((c) => c.deck_id === d.deck_id);
    expect(cmds(deck("ana", "Quill", "UB"))).toMatchObject([
      { slot: 1, role: "commander", typed_name: "Quill, Test Commander", scryfall_oracle_id: "" },
    ]);
    expect(cmds(deck("bo", "Quill", "WRG")).map((c) => [c.role, c.typed_name])).toEqual([
      ["commander", "Quill Half One"],
      ["partner", "Quill Half Two"],
    ]);
    const spark = deck("bo", "Spark", "UR");
    expect(spark.commander_status).toBe("resolved");
    expect(cmds(spark).map((c) => c.scryfall_oracle_id)).toEqual(["oid-a", "oid-b"]);
    expect(cmds(deck("ana", "Spark", "R"))).toMatchObject([{ typed_name: "Spark", scryfall_oracle_id: "" }]);
    expect(deck("ana", "Spark", "R").commander_status).toBe("unresolved");
  });
});

// Borrowed decks and guest deck text (invented names), shaped like the real Decks tab:
// "Kestrel (Bo)" in Ana's column is Bo's Kestrel played by Ana.
describe("migrate: borrowed decks and guest decks", () => {
  const decks = parseCsv(`Player:,Ana,Bo,Cy
Decks:,🟦🟥⬜Kestrel (Bo),🟥⬜🟦Kestrel,⬛Bramble (ana)
,🟩Fern,🟩Ghost (Cy),🟥⬜Vex(Precon)
,⬜⬛Bramble,,⬛Own (Cy)
`);
  const games = parseCsv(`Date,#,Players (In Turn Order),Decks,Winner,Bracket(s),Win Condition(s),Additional Rules(s),Notes
3/1/2026,1,Ana,🟦🟥⬜Kestrel (Bo),Ana,3,,,close game
,,Bo,🟥⬜🟦Kestrel,,,,,
,,Cy,⬛Bramble (Ana),,,,,second line
,,RANDOM,"Goblin Pile (with Zed's sleeves, lol)",,,,,
3/1/2026,2,Bo,🟩Ghost (Cy),RANDOM_Seat3,,,,
,,Cy,🟥⬜Vex(Precon),,,,,
,,RANDOM_Seat3,Wizard Tribal - Zed,,,,,
,,Ana,🟩Fern,,,,,
3/1/2026,3,Ana,🟩Fern,,,,,
,,Bo,🟥⬜🟦Kestrel,,,,,
,,Cy,⬛Own (Cy),,,,,
`);
  const res = migrate({ games, decks });
  const seatsOf = (i: number) => res.seats.filter((s) => s.game_id === res.games[i].game_id);
  const deckOf = (id: string) => res.decks.find((d) => d.deck_id === id)!;

  it("doesn't create a deck for the borrower; the seat uses the owner's deck", () => {
    expect(res.decks.map((d) => `${d.owner_player_id}|${d.name}|${d.colors}`).sort()).toEqual([
      "ana|Bramble|WB",
      "ana|Fern|G",
      "bo|Kestrel|WUR",
      "cy|Ghost|G",
      "cy|Own (Cy)|B",
      "cy|Vex|WR",
    ]);
    const [ana, bo, cy] = seatsOf(0);
    expect(ana).toMatchObject({ player_id: "ana", is_winner: true });
    expect(deckOf(ana.deck_id)).toMatchObject({ owner_player_id: "bo", name: "Kestrel" });
    expect(bo.deck_id).toBe(ana.deck_id);
    // Owner matched case-insensitively, deck matched by name despite other colors (⬛ vs ⬜⬛).
    expect(cy.player_id).toBe("cy");
    expect(deckOf(cy.deck_id)).toMatchObject({ owner_player_id: "ana", name: "Bramble", colors: "WB" });
  });

  it("creates the owner's deck with a warning when the owner doesn't list it", () => {
    const [bo] = seatsOf(1);
    expect(bo.player_id).toBe("bo");
    expect(deckOf(bo.deck_id)).toMatchObject({ owner_player_id: "cy", name: "Ghost" });
    expect(res.warnings.filter((w) => w.includes('Borrowed deck "🟩Ghost (Cy)"'))).toHaveLength(1);
  });

  it("moves (Precon) into the deck notes and keeps other parentheses in the nickname", () => {
    expect(deckOf(seatsOf(1)[1].deck_id)).toMatchObject({ owner_player_id: "cy", name: "Vex", notes: "Precon" });
    expect(deckOf(seatsOf(2)[2].deck_id)).toMatchObject({ owner_player_id: "cy", name: "Own (Cy)" });
  });

  it("keeps real notes and puts guests' deck text on their seats", () => {
    expect(res.games[0].notes).toBe("close game · second line");
    expect(seatsOf(0)[3]).toMatchObject({ player_id: "RANDOM", guest_deck: "Goblin Pile (with Zed's sleeves, lol)", guest_name: "" });
    // "RANDOM_Seat3" in the player column is a guest too.
    expect(seatsOf(1)[2]).toMatchObject({ player_id: "RANDOM", deck_id: "", is_winner: true, guest_deck: "Wizard Tribal", guest_name: "Zed" });
    expect(res.games[1].notes).toBe("");
    expect(res.players.map((p) => p.player_id)).toEqual(["ana", "bo", "cy"]);
  });

  it("imports a game with no winner as unfinished", () => {
    expect(res.games.map((g) => g.result)).toEqual(["won", "won", "unfinished"]);
    expect(res.games[2].brackets).toEqual([]);
  });
});
