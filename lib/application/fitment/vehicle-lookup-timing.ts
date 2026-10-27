type Stage = 'catalog.makes.origin' | 'catalog.models.origin' | 'catalog.years.origin'
  | 'applications.model-scope' | 'applications.database'
  | 'request.makes' | 'request.models' | 'request.years' | 'request.applications';

/** Internal aggregate timings only. Never log identities, URLs, inputs or errors. */
export async function timeVehicleLookup<T>(stage: Stage, work: () => PromiseLike<T>): Promise<T> {
  const started = performance.now();
  let outcome: 'ok' | 'error' = 'ok';
  try {
    return await work();
  } catch (error) {
    outcome = 'error';
    throw error;
  } finally {
    const durationMs = Math.round(performance.now() - started);
    if (process.env.NEXAUTO_VEHICLE_TIMINGS === '1' || durationMs >= 750 || outcome === 'error') {
      console.info(JSON.stringify({ event: 'vehicle_lookup_timing', stage, durationMs, outcome }));
    }
  }
}
