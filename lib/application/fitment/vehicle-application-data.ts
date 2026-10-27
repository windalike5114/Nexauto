import { engineLabelWithCodes } from '../../vehicle-catalog-display';

export type VehicleCatalogApplicationOption = {
  id: string; seriesId: string | null; seriesName: string; powertrainId: string; engine: string;
  variantId: string; variantName: string; bodyStyle: string; driveType: string; vehicleClass: string;
  displayEngine?: string;
};
type Powertrain = { powertrain_id: string; raw_name: string; display_name: string; short_display_name: string };
export type JoinedVehicleApplication = {
  application: {
    application_id: string; model_id: string;
    model: { make_id: string; status: string; make: { status: string } };
    series: { series_id: string; display_name: string; status: string } | null;
    powertrain: Powertrain;
    variant: { variant_id: string; display_name: string; body_style: string | null; drive_type: string | null; vehicle_class: string | null };
  };
};

// Follow the declared application foreign keys; embedding on the search view can
// infer a make-wide reverse relationship instead of the single engine we need.
export const vehicleApplicationProjection = `application:vehicle_catalog_applications!inner(
  application_id,model_id,
  model:vehicle_catalog_models!inner(make_id,status,make:vehicle_catalog_makes!inner(status)),
  series:vehicle_catalog_series(series_id,display_name,status),
  powertrain:vehicle_catalog_powertrains!inner(powertrain_id,raw_name,display_name,short_display_name),
  variant:vehicle_catalog_variants!inner(variant_id,display_name,body_style,drive_type,vehicle_class))`;

export function mapVehicleApplications(rows: JoinedVehicleApplication[]): VehicleCatalogApplicationOption[] {
  if (rows.length > 500) throw new Error('Vehicle selection exceeds the configuration limit.');
  const engines = new Map<string, Powertrain>();
  for (const { application } of rows) engines.set(application.powertrain.powertrain_id, application.powertrain);
  const labels = new Map<string, string>();
  const identicalLabels = new Map<string, string[]>();
  for (const engine of engines.values()) {
    const label = engineLabelWithCodes(engine.display_name, engine.raw_name);
    labels.set(engine.powertrain_id, label);
    identicalLabels.set(label, [...(identicalLabels.get(label) ?? []), engine.powertrain_id]);
  }
  // Keep genuinely different engine identities distinguishable, as before.
  for (const ids of identicalLabels.values()) if (ids.length > 1) {
    for (const id of ids) labels.set(id, engines.get(id)!.raw_name);
  }
  return rows.map(({ application: app }) => {
    const engine = app.powertrain, variant = app.variant;
    const series = app.series?.status === 'active' ? app.series : null;
    return {
      id: app.application_id, seriesId: series?.series_id ?? null, seriesName: series?.display_name ?? '',
      powertrainId: engine.powertrain_id, engine: labels.get(engine.powertrain_id)!,
      variantId: variant.variant_id, variantName: variant.display_name,
      bodyStyle: variant.body_style ?? '', driveType: variant.drive_type ?? '', vehicleClass: variant.vehicle_class ?? '',
      displayEngine: engine.short_display_name?.replace(/\s*\d+[- ]cyl(?:inders?)?/gi, '').split(/\s*[—–]\s*/)[0].trim()
    };
  }).sort((a, b) => a.seriesName.localeCompare(b.seriesName) || a.engine.localeCompare(b.engine)
    || a.variantName.localeCompare(b.variantName) || a.id.localeCompare(b.id));
}
