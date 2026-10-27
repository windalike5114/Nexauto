import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_POPULAR_VEHICLE_GROUPS,
  EXPANDED_POPULAR_VEHICLE_GROUPS,
  OPERATIONAL_POPULAR_VEHICLE_GROUPS,
  POPULAR_CORE_75_VEHICLE_GROUPS,
  POPULAR_EXTENDED_80_VEHICLE_GROUPS,
  REQUESTED_POPULAR_VEHICLE_GROUPS,
  buildPopularAliasIndex,
  groupsForPopularScope,
  popularGroupMatchesApplication
} from "../scripts/catalog/popular-vehicle-models.mjs";

test("requested popular vehicle list contains the ranked 50 groups", () => {
  assert.equal(REQUESTED_POPULAR_VEHICLE_GROUPS.length, 50);
  assert.deepEqual(REQUESTED_POPULAR_VEHICLE_GROUPS.map((group) => group.rank), Array.from({ length: 50 }, (_, index) => index + 1));
});

test("default and extended popular scopes match the New Zealand fleet thresholds", () => {
  assert.equal(POPULAR_CORE_75_VEHICLE_GROUPS.length, 103);
  assert.equal(DEFAULT_POPULAR_VEHICLE_GROUPS, POPULAR_CORE_75_VEHICLE_GROUPS);
  assert.equal(POPULAR_EXTENDED_80_VEHICLE_GROUPS.length, 132);
  assert.equal(groupsForPopularScope("historical50").length, 50);
  assert.equal(groupsForPopularScope("core75").length, 103);
  assert.equal(groupsForPopularScope("extended80").length, 132);
});

test("operational scope preserves BYD Shark 6 without changing the fleet threshold counts", () => {
  assert.equal(OPERATIONAL_POPULAR_VEHICLE_GROUPS.length, 104);
  assert.equal(EXPANDED_POPULAR_VEHICLE_GROUPS, OPERATIONAL_POPULAR_VEHICLE_GROUPS);
  assert.equal(new Set(OPERATIONAL_POPULAR_VEHICLE_GROUPS.map((group) => group.id)).size, 104);
  assert.equal(buildPopularAliasIndex(OPERATIONAL_POPULAR_VEHICLE_GROUPS).get("byd|shark6")?.label, "BYD Shark 6");
});

test("market-name aliases resolve to the same reporting group", () => {
  const index = buildPopularAliasIndex(REQUESTED_POPULAR_VEHICLE_GROUPS);
  assert.equal(index.get("mazda|demio"), index.get("mazda|2"));
  assert.equal(index.get("toyota|vitz"), index.get("toyota|yaris"));
  assert.equal(index.get("toyota|highlander"), index.get("toyota|kluger"));
  assert.equal(index.get("bmw|3")?.label, "BMW 3 Series");
  assert.equal(index.get("honda|jazz"), index.get("honda|fit"));
  assert.equal(index.get("nissan|qashqai"), index.get("nissan|dualis"));
  assert.equal(index.get("hyundai|tucson"), index.get("hyundai|ix35"));
});

test("fleet family aliases resolve inside the core and extended scopes", () => {
  const core = buildPopularAliasIndex(POPULAR_CORE_75_VEHICLE_GROUPS);
  const extended = buildPopularAliasIndex(POPULAR_EXTENDED_80_VEHICLE_GROUPS);
  assert.equal(core.get("mazda|atenza"), core.get("mazda|mazda6"));
  assert.equal(core.get("ford|escape"), core.get("ford|kuga"));
  assert.equal(core.get("honda|hrv"), core.get("honda|vezel"));
  assert.equal(core.get("nissan|caravan"), core.get("nissan|nv350"));
  assert.equal(extended.get("mercedesbenz|c")?.label, "Mercedes-Benz C-Class");
});

test("MINI hatch scope excludes other body families", () => {
  const mini = POPULAR_CORE_75_VEHICLE_GROUPS.find((group) => group.label === "MINI hatch family");
  assert.ok(mini);
  assert.equal(popularGroupMatchesApplication(mini, { body_style: "Hatchback" }), true);
  assert.equal(popularGroupMatchesApplication(mini, { body_style: "Clubman Wagon" }), false);
  assert.equal(popularGroupMatchesApplication(mini, { body_style: "Convertible" }), false);
  assert.equal(popularGroupMatchesApplication(mini, { body_style: "SUV" }), false);
});
