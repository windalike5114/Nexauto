import assert from "node:assert/strict";
import test from "node:test";
import { applyReviewedDecisions } from "../scripts/catalog/apply-reviewed-fitments-v6.mjs";

test("reviewed supplier refs publish only the selected candidate", () => {
  const prepared = {
    brakeCatalog: [
      { sku: "NBP1", supplierRef: "DB1" },
      { sku: "NBP2", supplierRef: "DB2" }
    ],
    oilCatalog: [],
    productFitments: [
      { product_type: "brake_pad", application_id: "ap_1", position: "rear", sku: "NBP1", fitment_status: "review" },
      { product_type: "brake_pad", application_id: "ap_1", position: "rear", sku: "NBP2", fitment_status: "review" }
    ]
  };
  const decisions = [{
    review_id: "BRK-1",
    product_type: "brake_pad",
    application_id: "ap_1",
    position: "rear",
    candidates: ["DB1", "DB2"],
    decision: "DB2",
    selected_refs: ["DB2"]
  }];
  const result = applyReviewedDecisions(prepared, decisions);
  assert.deepEqual(result.productFitments.map((row) => [row.sku, row.fitment_status]), [
    ["NBP1", "review"],
    ["NBP2", "published"]
  ]);
  assert.equal(result.unresolvedFitments.length, 0);
});

test("NONE keeps every candidate unpublished", () => {
  const prepared = {
    brakeCatalog: [],
    oilCatalog: [{ sku: "NOF1", supplierRef: "Z1" }],
    productFitments: [
      { product_type: "oil_filter", application_id: "ap_2", position: "engine", sku: "NOF1", fitment_status: "published" }
    ]
  };
  const decisions = [{
    review_id: "OIL-1",
    product_type: "oil_filter",
    application_id: "ap_2",
    position: "engine",
    candidates: ["Z1"],
    decision: "NONE",
    selected_refs: []
  }];
  const result = applyReviewedDecisions(prepared, decisions);
  assert.equal(result.productFitments[0].fitment_status, "review");
  assert.equal(result.productFitments[0].fitment_status_reason, "manual_review_no_compatible_candidate");
});

test("compound supplier refs with slash remain atomic", () => {
  const prepared = {
    brakeCatalog: [],
    oilCatalog: [{ sku: "NOF1", supplierRef: "Z411/Z547" }],
    productFitments: [
      { product_type: "oil_filter", application_id: "ap_3", position: "engine", sku: "NOF1", fitment_status: "review" }
    ]
  };
  const decisions = [{
    review_id: "OIL-2",
    product_type: "oil_filter",
    application_id: "ap_3",
    position: "engine",
    candidates: ["Z411/Z547"],
    decision: "Z411/Z547",
    selected_refs: ["Z411/Z547"]
  }];
  const result = applyReviewedDecisions(prepared, decisions);
  assert.equal(result.productFitments[0].fitment_status, "published");
});
