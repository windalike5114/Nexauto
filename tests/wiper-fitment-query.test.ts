import assert from "node:assert/strict";
import test from "node:test";
import { mapCanonicalFitmentRow, type CanonicalFitmentRow } from "../lib/queries/wiper-fitment";

test("canonical fitment mapper preserves generation, body, and blade positions", () => {
  const result = mapCanonicalFitmentRow(canonicalRow());

  assert.ok(result);
  assert.equal(result.applicationKind, "canonical");
  assert.equal(result.make, "Toyota");
  assert.equal(result.model, "Corolla");
  assert.equal(result.generationName, "E210");
  assert.equal(result.bodyStyle, "hatchback");
  assert.equal(result.driverLengthIn, 26);
  assert.equal(result.passengerLengthIn, 16);
  assert.equal(result.rearLengthIn, 12);
});

test("canonical fitment mapper rejects incomplete relationships", () => {
  assert.equal(mapCanonicalFitmentRow({ ...canonicalRow(), wiper_configurations: null }), null);
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
