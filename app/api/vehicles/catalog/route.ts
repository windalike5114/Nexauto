import { createVehicleCatalogHandler } from '@/lib/application/fitment/vehicle-catalog-api';
import { listPublicVehicleMakes, listPublicVehicleModels, listPublicVehicleYears } from '@/lib/queries/public-vehicle-catalog';

export const GET = createVehicleCatalogHandler({makes:listPublicVehicleMakes,models:listPublicVehicleModels,years:listPublicVehicleYears});
