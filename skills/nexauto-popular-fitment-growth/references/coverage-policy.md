# Coverage and priority policy

## Coverage meanings

- Product coverage means a published relationship to a real, active NexAuto product that can satisfy the requested position or configuration.
- Knowledge coverage means a reliable published fitment, whether or not a sellable product exists.
- Review, draft, rejected, unresolved, and conditional rows that cannot be evaluated from catalog fields do not count as covered.
- A product-line-specific reference layer may contribute to knowledge coverage but never automatically to product coverage.

## Denominators

- Application: each active NexAuto application once.
- Application-year: each active application multiplied by every attached year inside the requested period.
- Model-year-any: at least one application in the popular group and year is covered.
- Model-year-full: every application in the popular group and year is covered.

Always show any and full together. A high any rate with a low full rate means some body, drivetrain, engine, or platform variants remain missing.

## Projected uplift

For a batch, calculate:

`projected_pp = safe_new_application_years / denominator_application_years * 100`

Do not count a whole group as solved when only sample applications were resolved. Do not count product uplift unless a real product or complete sellable configuration exists.

## Priority fields

- Coverage priority: sort by missing application-years, then projected percentage points.
- Commercial gap proxy: `fleet_count * (1 - knowledge_application_year_rate)`.

The commercial value is a prioritization proxy, not an exact number of unsupported registered vehicles.

## Batch acceptance

A report-only batch must reconcile its baseline with the central coverage report, identify every source row and target application, and exclude existing conflicting published rows. An apply batch must additionally include a backup, idempotent writes, readback, duplicate checks, unchanged-row checks, and an after report using the original denominator.
