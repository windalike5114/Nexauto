# Product-line rules

## Wipers

- Knowledge is the published blade-length configuration, including valid partial or rear-only information.
- Product coverage requires a complete active sellable front pair for the published front configuration.
- Keep valid lengths when no product exists. Create a product/commercial queue instead of deleting or downgrading knowledge.
- Reuse a verified platform across engine and trim differences only after chassis and compatible body are established.
- Front lengths may be platform-wide; rear applicability remains body-sensitive.
- Multiple lengths without a deterministic platform/body/year split remain review.

## Brake pads

- The matching key is primarily platform/chassis plus front/rear position.
- Engine, trim, and year are secondary discriminators only when evidence shows different calipers, brake packages, drive layouts, production dates, disc sizes, PR codes, or OEM numbers.
- A DB reference belongs in the brake reference layer. It is not a NexAuto SKU and may exist without a sellable NBP product.
- One NBP product may have multiple cross-references. Keep supplier SKU and market references separate from the NexAuto unique SKU.
- Rear drum brakes mean rear brake pads are not applicable; do not count them as a missing pad or convert a brake-shoe reference into a brake-pad product.
- Unique source candidates with no conflict can enter the safe queue. Multi-DB platform groups remain conditional or review until a catalog field can express the distinction.

Use the layers consistently:

- `NBPxxxx` is the unique NexAuto product SKU.
- `DBxxxx` is an industry cross-reference and belongs in the brake reference layer.
- `CDBxxxx` is a supplier identifier derived from the corresponding DB reference; retain it as supplier metadata/cross-reference, not as a second NexAuto product identity.
- A published DB relationship counts as brake knowledge even when no NBP product exists. It counts as product coverage only after an active NBP product is linked.
- Platform/chassis plus position may be propagated across engines only when the source has one DB candidate or the catalog stores the discriminator that separates multiple candidates.
- When multiple DB candidates exist, prefer stored drive, production date, disc size, caliper, PR code, OEM, or brake-package evidence. Do not use a majority vote as proof.

## Oil filters

- The primary matching identity is normally engine code plus OEM/market reference, not chassis alone.
- Displacement, cylinder count, aspiration, and production year are secondary checks; do not propagate across engines solely because the applications share a platform.
- The NexAuto SKU remains unique. Ryco and other market-standard numbers are cross-references; Topstar or another supplier number is a supplier identifier.
- One NexAuto product may carry several cross-references, and the same broad market reference may require separate NexAuto products when verified dimensions or application constraints differ.

## Other filters and future lines

- Treat every new product line as independent even when it shares the vehicle catalog.
- Define its own reference type, product identifiers, matching hard keys, positions where relevant, coverage semantics, and publication rules before importing fitments.
- Do not reuse wiper or brake propagation rules merely because the applications share a chassis.
