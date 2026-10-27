import 'server-only';
import { listVehicleCatalogApplications } from '@/lib/queries/vehicle-catalog';
import { listPublicVehicleMakes, listPublicVehicleModels } from '@/lib/queries/public-vehicle-catalog';
import { groupFriendlyApplications, sharedVehicleDetails, type FriendlyApplication } from '@/lib/vehicle-variants';
import type { VehicleContext } from '@/lib/vehicle-context';

/** Rebuild identity from the current database, never from client labels or an arbitrary first member. */
export async function resolveVehicleSelection(context: VehicleContext | null): Promise<{ vehicle: VehicleContext; applications: FriendlyApplication[] } | null> {
  if (!context) return null;
  const [applications, makes] = await Promise.all([
    listVehicleCatalogApplications(context.makeId, context.modelId, Number(context.year)),
    listPublicVehicleMakes()
  ]);
  const group = context.variantGroup ? groupFriendlyApplications(applications).find(group => group.id === context.variantGroup) : null;
  if (context.variantGroup && !group) return null;
  const requested = new Set(context.applicationIds?.length ? context.applicationIds : context.applicationId ? [context.applicationId] : []);
  const members = group?.applications ?? applications.filter(app => requested.has(app.id));
  if (!members.length || (!group && members.length !== requested.size)) return null;
  const make = makes.find(make => make.id === context.makeId);
  const model = (await listPublicVehicleModels(context.makeId)).find(model => model.modelIds.includes(context.modelId));
  if (!make || !model) return null;
  const exact = members.length === 1 ? members[0] : null;
  return { applications: members, vehicle: {
    makeId: make.id, modelId: context.modelId, make: make.name, model: model.name, year: context.year,
    variantGroup: group?.id, versionLabel: group?.name ?? groupFriendlyApplications(members).map(group=>group.name).join(' / '),
    applicationIds: members.map(app => app.id), applicationId: exact?.id,
    generationId: exact?.seriesId ?? undefined, variantId: exact?.variantId,
    ...sharedVehicleDetails(members),
    bodyConfiguration: group?.name ?? [members[0].bodyStyle, members[0].driveType].filter(Boolean).join(' · ')
  } };
}
