import { createVehicleApplicationsHandler } from '@/lib/application/fitment/vehicle-catalog-api';
import { listVehicleCatalogApplications } from "@/lib/queries/vehicle-catalog";

export const GET = createVehicleApplicationsHandler(listVehicleCatalogApplications);
