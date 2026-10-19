import { describe, expect, it } from "vitest";
import { canPair, identityOf, pairKinds, partnerQuery, type ScryCard } from "@/lib/scryfall";

const card = (name: string, oracle_text: string, type_line = "Legendary Creature", ci: string[] = []): ScryCard => ({
  id: name,
  oracle_id: name,
  name,
  oracle_text,
  type_line,
  color_identity: ci,
  keywords: [],
});

const thrasios = card("Thrasios, Triton Hero", "{4}: Scry 1...\nPartner (You can have two commanders if both have partner.)");
const tymna = card("Tymna the Weaver", "Lifelink\nPartner (You can have two commanders if both have partner.)");
const pir = card("Pir, Imaginative Rascal", "Partner with Toothy, Imaginary Friend (When this creature enters...)");
const toothy = card("Toothy, Imaginary Friend", "Partner with Pir, Imaginative Rascal (When this creature enters...)");
const wilson = card("Wilson, Refined Grizzly", "Choose a Background (You can have a Background as a second commander.)\nReach");
const bg = card("Raised by Giants", "Commander creatures you own have base power and toughness 10/10", "Legendary Enchantment — Background");
const ff1 = card("Will, the Wise", "Friends forever (You can have two commanders if both have friends forever.)");
const ff2 = card("Eleven, the Mage", "Friends forever (You can have two commanders if both have friends forever.)");
const doctor = card("The Tenth Doctor", "Allons-y!", "Legendary Creature — Time Lord Doctor");
const companion = card("Rose Tyler", "Doctor's companion (You can have two commanders if the other is the Doctor.)");
const plain = card("Atraxa, Praetors' Voice", "Flying, vigilance, deathtouch, lifelink");

describe("pairing", () => {
  it("pairs plain partners but not partner-with strangers", () => {
    expect(canPair(thrasios, tymna)).toBe(true);
    expect(canPair(pir, toothy)).toBe(true);
    expect(canPair(pir, thrasios)).toBe(false);
    expect(pairKinds(pir)).toEqual([{ kind: "partner-with", name: "Toothy, Imaginary Friend" }]);
  });
  it("handles backgrounds, friends forever and the Doctor", () => {
    expect(canPair(wilson, bg)).toBe(true);
    expect(canPair(bg, wilson)).toBe(true);
    expect(canPair(ff1, ff2)).toBe(true);
    expect(canPair(ff1, thrasios)).toBe(false);
    expect(canPair(doctor, companion)).toBe(true);
  });
  it("refuses cards without a pairing ability", () => {
    expect(canPair(plain, thrasios)).toBe(false);
    expect(partnerQuery(plain, "")).toBeNull();
    expect(partnerQuery(wilson, "")).toContain("t:background");
  });
  it("unions color identity in WUBRG order", () => {
    expect(identityOf([{ color_identity: ["G", "U"] }, { color_identity: ["W"] }])).toBe("WUG");
    expect(identityOf([{ color_identity: [] }])).toBe("C");
  });
});
