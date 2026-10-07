import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWiperFitmentVariantResolution,
  groupWiperFitmentModels,
  groupWiperFitmentModelsUsingMaster,
  mapCanonicalFitmentRow,
  type CanonicalFitmentRow,
  type WiperFitmentResult
} from "../lib/queries/wiper-fitment";

test("canonical fitment mapper preserves generation, body, and blade positions", () => {
  const result = mapCanonicalFitmentRow(canonicalRow());

  assert.ok(result);
  assert.equal(result.applicationKind, "canonical");
  assert.equal(result.make, "Toyota");
  assert.equal(result.model, "Corolla");
  assert.equal(result.generationName, "E210");
  assert.deepEqual(result.chassisCodes, ["MZEA12", "ZWE211"]);
  assert.equal(result.bodyStyle, "hatchback");
  assert.equal(result.driverLengthIn, 26);
  assert.equal(result.passengerLengthIn, 16);
  assert.equal(result.rearLengthIn, 12);
});

test("canonical fitment mapper rejects incomplete relationships", () => {
  assert.equal(mapCanonicalFitmentRow({ ...canonicalRow(), wiper_configurations: null }), null);
});

test("model groups collapse chassis and body variants while retaining every source model id", () => {
  const groups = groupWiperFitmentModels([
    { id: "falcon", name: "Falcon" },
    { id: "falcon-ba-bf", name: "Falcon - BA - BF" },
    { id: "falcon-au-sedan", name: "Falcon AU Sedan" },
    { id: "land-cruiser", name: "Land Cruiser" },
    { id: "land-cruiser-prado", name: "Land Cruiser Prado" },
    { id: "yaris", name: "Yaris" },
    { id: "yaris-hatch", name: "Yaris Hatch" },
    { id: "yaris-verso", name: "Yaris Verso P2" }
  ]);

  const falcon = groups.find((group) => group.name === "Falcon");
  assert.deepEqual(falcon?.modelIds, ["falcon", "falcon-ba-bf", "falcon-au-sedan"]);
  assert.deepEqual(falcon?.aliases, ["Falcon", "Falcon - BA - BF", "Falcon AU Sedan"]);
  assert.equal(groups.some((group) => group.name === "Land Cruiser Prado"), true);
  assert.deepEqual(groups.find((group) => group.name === "Yaris")?.modelIds, ["yaris", "yaris-hatch"]);
  assert.equal(groups.some((group) => group.name === "Yaris Verso P2"), true);
});

test("Machter master models remain authoritative instead of being merged into shorter marketing names", () => {
  const groups = groupWiperFitmentModelsUsingMaster([
    { id: "legacy-falcon", name: "Falcon - BA - BF" },
    { id: "legacy-verso", name: "Yaris Verso P2" },
    { id: "legacy-cross", name: "Yaris Cross" },
    { id: "legacy-gr", name: "Yaris GR" }
  ], [
    { id: "master-falcon", name: "Falcon" },
    { id: "master-yaris", name: "Yaris" },
    { id: "master-verso", name: "Yaris Verso" },
    { id: "master-cross", name: "Yaris Cross" }
  ]);

  assert.deepEqual(groups.map((group) => group.name), ["Falcon", "Yaris", "Yaris Cross", "Yaris Verso"]);
  assert.deepEqual(groups.find((group) => group.name === "Falcon")?.modelIds, ["master-falcon", "legacy-falcon"]);
  assert.deepEqual(groups.find((group) => group.name === "Yaris Verso")?.modelIds, ["master-verso", "legacy-verso"]);
});

test("master model matching tolerates make prefixes and punctuation differences", () => {
  const groups = groupWiperFitmentModelsUsingMaster([
    { id: "legacy-3", name: "Mazda3 - BK" },
    { id: "legacy-bt50", name: "BT-50" },
    { id: "legacy-landcruiser", name: "Landcruiser - 100 Series" },
    { id: "legacy-prado", name: "Landcruiser Prado - 120 Series" },
    { id: "legacy-land-cruiser-prado", name: "Land Cruiser Prado" }
  ], [
    { id: "master-3", name: "3" },
    { id: "master-bt50", name: "BT50" },
    { id: "master-landcruiser", name: "Land Cruiser" },
    { id: "master-prado", name: "Prado" }
  ], "Mazda");
  assert.deepEqual(groups.map((group) => group.name), ["3", "BT50", "Land Cruiser", "Prado"]);
  assert.deepEqual(groups.find((group) => group.name === "Prado")?.aliases, ["Land Cruiser Prado", "Landcruiser Prado - 120 Series", "Prado"]);
});

test("variant selection is skipped for a unique fitment but retained for distinct versions", () => {
  const single = buildWiperFitmentVariantResolution([legacyFitment()], "Falcon");
  assert.equal(single.requiresSelection, false);
  assert.equal(single.automaticVariant?.name, "BA Sedan · 2002–2005");

  const distinct = buildWiperFitmentVariantResolution([
    legacyFitment(),
    { ...legacyFitment(), applicationId: "application-2", model: "Falcon BF Wagon" }
  ], "Falcon");
  assert.equal(distinct.requiresSelection, true);
  assert.equal(distinct.automaticVariant, null);
});

test("incomplete duplicate fitments are not treated as proven equivalent", () => {
  const fitment = { ...legacyFitment(), rearLengthIn: null };
  const resolution = buildWiperFitmentVariantResolution([
    fitment,
    { ...fitment, applicationId: "application-2" }
  ], "Falcon");
  assert.equal(resolution.requiresSelection, true);
});

function canonicalRow(): CanonicalFitmentRow {
  return {
    id: "fitment-1",
    fitment_status: "published",
    vehicle_fitment_applications: {
      id: "application-1",
      year_start: 2019,
      year_end: null,
      fitment_status: "published",
      active: true,
      vehicle_variants: { id: "variant-1", name: "Hatchback", body_style: "hatchback" },
      vehicle_generations: {
        id: "generation-1",
        name: "E210",
        active: true,
        vehicle_chassis_assignments: [
          { id: "assignment-1", variant_id: "variant-1", is_primary: true, vehicle_chassis_codes: { code: "MZEA12" } },
          { id: "assignment-2", variant_id: null, is_primary: false, vehicle_chassis_codes: { code: "ZWE211" } },
          { id: "assignment-3", variant_id: "other-variant", is_primary: false, vehicle_chassis_codes: { code: "NRE210" } }
        ],
        vehicle_models: {
          id: "model-1",
          name: "Corolla",
          make_id: "make-1",
          vehicle_makes: { id: "make-1", name: "Toyota" }
        }
      }
    },
    wiper_configurations: {
      id: "configuration-1",
      configuration_status: "published",
      rear_status: "fitted",
      wiper_configuration_blades: [
        { position: "driver", length_in: 26 },
        { position: "passenger", length_in: 16 },
        { position: "rear", length_in: 12 }
      ]
    }
  };
}

function legacyFitment(): WiperFitmentResult {
  return {
    applicationId: "application-1",
    applicationKind: "legacy",
    make: "Ford",
    model: "Falcon BA Sedan",
    generationName: null,
    variantName: null,
    bodyStyle: null,
    startRaw: "2002 - 2005 (BA)",
    endRaw: "2002 - 2005 (BA)",
    startYear: 2002,
    endYear: 2005,
    driverLengthIn: 22,
    passengerLengthIn: 22,
    rearLengthIn: 16
  };
}
