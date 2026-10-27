import test from 'node:test';
import assert from 'node:assert/strict';
import { mapVehicleApplications, type JoinedVehicleApplication } from '../lib/application/fitment/vehicle-application-data';
import { timeVehicleLookup } from '../lib/application/fitment/vehicle-lookup-timing';

function row(id: string, overrides: Partial<JoinedVehicleApplication['application']> = {}): JoinedVehicleApplication {
  return { application: {
    application_id: id, model_id: 'model', model: { make_id: 'make', status: 'active', make: { status: 'active' } },
    series: { series_id: 'series', display_name: 'NZE161', status: 'active' },
    powertrain: { powertrain_id: 'engine', raw_name: '1.5L 1NZ-FE DOHC Petrol', display_name: '1.5L Petrol 4-cyl', short_display_name: '1.5L Petrol 4-cyl' },
    variant: { variant_id: 'variant', display_name: 'Wagon FWD', body_style: 'Wagon', drive_type: 'FWD', vehicle_class: 'Passenger' },
    ...overrides
  } };
}

test('joined data preserves the public six-level identity and excludes internal rows', () => {
  const [mapped] = mapVehicleApplications([row('application')]);
  assert.deepEqual(mapped, { id: 'application', seriesId: 'series', seriesName: 'NZE161', powertrainId: 'engine',
    engine: '1.5L Petrol 4-cyl — 1NZ-FE', variantId: 'variant', variantName: 'Wagon FWD',
    bodyStyle: 'Wagon', driveType: 'FWD', vehicleClass: 'Passenger', displayEngine: '1.5L Petrol' });
  assert.doesNotMatch(JSON.stringify(mapped), /raw_name|make_id|model_id|status|short_display_name/);
});

test('repeated engines do not look ambiguous, while distinct identical-label engines keep raw distinctions', () => {
  const a = row('a'), b = row('b');
  assert.equal(mapVehicleApplications([a, b])[0].engine, '1.5L Petrol 4-cyl — 1NZ-FE');
  const c = row('c', { powertrain: { ...a.application.powertrain, powertrain_id: 'other', raw_name: '1.5L 1NZ-FE DOHC Petrol revised' } });
  const mapped = mapVehicleApplications([a, c]);
  assert.deepEqual(new Set(mapped.map(app => app.engine)), new Set([a.application.powertrain.raw_name, c.application.powertrain.raw_name]));
  assert.equal(new Set(mapped.map(app => app.powertrainId)).size, 2);
});

test('inactive or absent series and nullable body data retain search-view behaviour', () => {
  const a = row('a', { series: { series_id: 'retired', display_name: 'Old', status: 'inactive' } });
  const b = row('b', { series: null, variant: { variant_id: 'v', display_name: '', body_style: null, drive_type: null, vehicle_class: null } });
  for (const app of mapVehicleApplications([a, b])) { assert.equal(app.seriesId, null); assert.equal(app.seriesName, ''); }
  const empty = mapVehicleApplications([b])[0];
  assert.deepEqual([empty.bodyStyle, empty.driveType, empty.vehicleClass], ['', '', '']);
});

test('stable result order and the 500-configuration cap are preserved', () => {
  assert.deepEqual(mapVehicleApplications([row('b'), row('a')]).map(app => app.id), ['a', 'b']);
  assert.equal(mapVehicleApplications(Array.from({ length: 500 }, (_, i) => row(String(i)))).length, 500);
  assert.throws(() => mapVehicleApplications(Array.from({ length: 501 }, () => row('a'))), /configuration limit/);
  assert.deepEqual(mapVehicleApplications([]), []);
});

test('internal timing logs contain only fixed stages and timings, including on errors', async () => {
  const logs: string[] = [], previous = process.env.NEXAUTO_VEHICLE_TIMINGS, original = console.info;
  process.env.NEXAUTO_VEHICLE_TIMINGS = '1'; console.info = value => { logs.push(String(value)); };
  try {
    const secret = { raw_name: 'private engine source', user: 'customer@example.test' };
    assert.equal(await timeVehicleLookup('applications.database', async () => secret), secret);
    const error = new Error('SQL database credential secret');
    await assert.rejects(timeVehicleLookup('applications.database', async () => { throw error; }), value => value === error);
    assert.equal(logs.length, 2);
    for (const line of logs) {
      const log = JSON.parse(line);
      assert.deepEqual(Object.keys(log).sort(), ['durationMs', 'event', 'outcome', 'stage']);
      assert.equal(log.event, 'vehicle_lookup_timing'); assert.ok(log.durationMs >= 0);
      assert.doesNotMatch(line, /SQL|credential|raw_name|private engine|customer@/);
    }
    assert.equal(JSON.parse(logs[1]).outcome, 'error');
  } finally {
    console.info = original;
    if (previous === undefined) delete process.env.NEXAUTO_VEHICLE_TIMINGS;
    else process.env.NEXAUTO_VEHICLE_TIMINGS = previous;
  }
});
