# Fitment V6 deployment

This release connects the normalized V5 vehicle catalogue to the brake-pad, oil-filter and wiper catalogues generated from the supplied fitment sources.

## Package contents

The complete normalized link data is stored in `data/fitment-v6/`:

- `brakepad_product_application_test.csv`: 25,761 SKU/application/position links.
- `oilfilter_product_application_test.csv`: 20,036 SKU/application links.
- `wiper_application_test.csv`: 22,584 size/application links with connector evidence.
- `fitment_match_issues.csv`: excluded, unmatched and conflicting source records.
- `fitment_test_summary.json`: measured counts and integrity checks.
- `README.md`: matching levels and confidence definitions.

## Publication policy

- Brake pads: high and medium confidence are published; low confidence is imported with `review` status. Front/rear position is mandatory.
- Oil filters: exact normalized engine-code matches are globally reusable across models and years. High and medium confidence are published; low confidence remains reviewable.
- Wipers: engine and drivetrain are ignored. A unique non-conflicting high/medium configuration is published only when a purchasable length pair exists. Conflicts, low-confidence links and unsupported sizes are retained for review.
- Wiper customer-facing SKU uses the smaller size first, for example `WPFP1826`. Connector evidence remains vehicle-specific in fitment notes and is not part of the SKU.

## Commands

```text
npm run test:fitment-v6
npm run fitment-v6:report
npm run fitment-v6:apply
```

The apply command verifies the active V5 vehicle release hash, backs up existing V5 fitment tables under `tmp/production-backups/`, upserts the NBP/NOF product catalogues, replaces V5 product and wiper fitments, and verifies resulting row counts.
