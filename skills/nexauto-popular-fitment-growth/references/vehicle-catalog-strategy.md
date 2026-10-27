# Shared vehicle-catalog strategy

The vehicle catalog is the common identity layer for every product line. Correct it globally, but validate and publish fitments separately by product line.

## Identity order

Evaluate identity from broad to narrow:

1. make and market-model aliases;
2. model ownership and family membership;
3. platform, generation, chassis, or series;
4. body style;
5. production date or model year;
6. drivetrain, engine, trim, brake package, or other product-specific discriminator.

Do not let a broad model alias pull unrelated bodies into a popular denominator. If the requested family is body-specific, store an application filter in `scripts/catalog/popular-vehicle-models.mjs` and test it.

## Corrections

- Incorrect model ownership: merge into an exact existing application when possible; otherwise reassign the vehicle identity. Preserve an old application ID to new application ID map.
- Duplicate applications: merge rather than rename into a unique-key collision. Reconcile years and relationships before inactivating the source.
- Impossible generation spans: remove unsupported years or split the application at evidence-backed boundaries.
- Transition years: keep them review-only when month/VIN/build-date evidence is required and the catalog cannot represent it.
- Body-sensitive data: keep wagon, hatch, sedan, van, bus, coupe, convertible, SUV, and special/open-body variants separate when the product can differ.
- Chassis patterns: normalize documented prefix, infix, and family rules, but do not use a text wildcard to cross a generation boundary.

## Relationship preservation

When applications are merged or split, inspect every product line independently:

- copy published, review, and rejected relationships with their original status and evidence;
- retain position and product-line reference type;
- preserve commerce links only when the target fitment knowledge remains valid;
- copy provenance/audit rows;
- reject or leave review any relationship whose discriminator was lost in the merge;
- check compound uniqueness keys, including source identifiers where present.

## Coverage interpretation

- Recalculate denominators after identity correction.
- Report removed invalid application-years separately from newly covered application-years.
- Use the same maintained popular-group definition across product lines, while applying product-line-specific not-applicable rules.
- A global vehicle correction may improve reporting quality without increasing coverage; do not present denominator cleanup as fitment uplift.

## Production gate

Before applying: produce the exact source/target set, relationship counts by product line, collision checks, and a backup plan.

After applying: verify active/inactive identities, exact years, relationship counts and statuses, duplicate published rows, provenance, product-layer invariants, and refreshed coverage for every affected product line.
