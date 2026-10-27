---
name: nexauto-popular-fitment-growth
description: Normalize the shared NexAuto vehicle catalog and plan, measure, or execute low-token fitment coverage growth across wipers, brake pads, filters, and future product lines. Use for vehicle identity corrections, popular-model coverage reports, knowledge/reference/product separation, per-model prioritization, script-first publication, or compact unresolved research queues.
---

# NexAuto Global Fitment Strategy

Improve customer-relevant coverage across every product line without inflating metrics, duplicating vehicle corrections, or coupling fitment knowledge to current inventory.

## Read first

- Read [references/coverage-policy.md](references/coverage-policy.md) before producing metrics or prioritizing work.
- Read [references/product-line-rules.md](references/product-line-rules.md) for every product line included in the task.
- Read [references/vehicle-catalog-strategy.md](references/vehicle-catalog-strategy.md) before changing model aliases, chassis/platform identities, bodies, years, or duplicate applications.
- For detailed wiper matching or production publication, also use the `nexauto-wiper-fitment` skill.

## Global architecture

Keep four layers distinct:

1. **Vehicle identity:** make, model/family aliases, platform/chassis, body, drivetrain, engine, production years, and application identity. This is shared by all product lines.
2. **Fitment knowledge/reference:** the product-line-specific fact that a blade configuration, DB number, filter reference, or other standard fits an application.
3. **NexAuto product:** the unique NexAuto SKU linked to one or more references and applications.
4. **Commerce:** sellability, stock, pricing, visibility, and checkout state.

Repair vehicle identity once, then recompute every product line. Never infer that a shared vehicle correction makes the product-line fitments interchangeable.

## Scope and baseline

- Load the popular scope from `scripts/catalog/popular-vehicle-models.mjs`; do not copy a numbered list into a new script.
- Use `DEFAULT_POPULAR_VEHICLE_GROUPS` unless the user explicitly requests historical50, extended80, or operational scope.
- State the year interval and denominator. The current default is 2000-2026.
- Recompute production state before every run. Old output files are evidence or snapshots, not the current baseline.
- Report application coverage, application-year coverage, model-year-any coverage, and model-year-full coverage. Treat application-year as the primary operational KPI.

## Work classification

Classify every missing target before research:

1. `knowledge_missing`: no reliable published fitment.
2. `product_missing`: reliable fitment exists, but no sellable NexAuto product covers it.
3. `multi_candidate`: evidence returns more than one configuration and the database lacks a deterministic discriminator.
4. `catalog_correction`: make/model/platform/body/year identity is wrong or too broad.

Never mix these queues. Product creation cannot repair missing knowledge, and deleting knowledge cannot repair missing inventory.

## Global-to-product-line execution

1. Audit vehicle identity and denominator first. Fix aliases, incorrect model ownership, impossible year spans, duplicate applications, and body-family leakage before measuring uplift.
2. Preserve an old-to-new application trace when merging duplicates. Move or copy each product line's relationships independently, retaining status, source, position, and evidence.
3. Recompute the baseline for every affected product line after a vehicle correction; denominator changes are catalog corrections, not coverage gains.
4. Within each product line, apply only its own hard keys from `product-line-rules.md`.
5. Publish deterministic knowledge even when no NexAuto product exists. Put missing SKUs or sellable combinations into a separate product queue.
6. Leave genuine multi-candidate rows in review unless a stored discriminator can reproduce the decision. Do not encode an unqueryable research conclusion as a universal fitment.

## Low-token execution

1. Use scripts to group applications by popular group, platform/chassis, position, body, and relevant years.
2. Deduplicate shared platform questions before delegating research.
3. Resolve `product_missing` locally from identifiers and cross-references before any web or AI work.
4. Resolve deterministic unique candidates locally when source, position, years, and production state agree.
5. Give AI only compact unresolved shared questions with exact candidate IDs, missing discriminator, required output schema, and a strict stop condition.
6. Do not send full catalogs, full snapshots, or one task per engine when the platform question is shared.
7. Require report-only output first. Production changes need a separate explicit apply step, backup, readback, duplicate check, and coverage reconciliation.

If an apply partially fails, stop, restore the preimage, verify the rollback, fix the script, and rerun the full batch. Never continue from an unknown half-written state.

## Prioritization

Maintain two independent rankings:

- `coverage_priority`: missing application-years and projected percentage-point gain.
- `commercial_priority`: fleet count multiplied by the knowledge-gap rate.

Use coverage priority to reach a numeric KPI efficiently. Use commercial priority to improve the experience for the most vehicles. Publish both rankings rather than hiding the tradeoff in one score.

## Required outputs

- baseline and projected coverage using the same denominator;
- per-popular-group CSV/JSON with product and knowledge metrics;
- safe-to-publish or safe-to-link rows;
- products or combinations to create;
- multi-candidate review queue;
- vehicle-catalog correction queue;
- source and rule audit;
- after-apply reconciliation when an apply was authorized.

Keep each product line in its own tables, identifiers, references, scripts, and audit queues. Shared vehicle identity does not make product fitment rules interchangeable.
