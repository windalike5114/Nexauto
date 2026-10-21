# NexAutoParts fitment matching test

This package is a provisional fitment test against the normalized vehicle database. The original source files were not modified.

## Product-specific matching level

- Brake pads: Make + Model + Year, then Series/chassis, engine code and displacement where available; position is mandatory.
- Oil filters: an exact normalized engine-code match is applied globally across makes, models and years because the same engine code shares the filter. If no exact engine code exists, fallback uses Make + Model + Year plus engine/displacement; when Model is missing, fallback still requires a positive engine-code or displacement match. Make + Year alone is never expanded across models.
- Wipers: Make + Model + Year is medium confidence; matching body or Series raises it to high. Engine and drive are intentionally ignored, and the result is inherited to all matching powertrains. A product SKU is generated from the two nominal inch sizes with the smaller size first, for example `WPFP1826`. Connector Type is stored and reviewed separately per vehicle application.

## Confidence

- high: vehicle identity plus a product-relevant discriminator matched.
- medium: useful product-specific match that can be reviewed or accepted under product rules.
- low: alias, ambiguous powertrain fallback, or another broad candidate retained provisionally.

## Files

- vehicle_catalog_fitment_test.sqlite: vehicle database copy with product and test-fitment tables.
- brakepad_product_application_test.csv: provisional brake-pad SKU mappings.
- oilfilter_product_application_test.csv: provisional oil-filter SKU mappings.
- wiper_application_test.csv: vehicle-to-wiper-spec mappings.
- fitment_match_issues.csv: unmatched and conflicting records.
- fitment_test_summary.json: measured results and validation.

Do not publish medium/low mappings as guaranteed fitment until reviewed. Product application tables retain source row, match method and confidence so corrections can be applied later.
