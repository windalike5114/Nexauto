import {createLegacyVehicleHandler} from '@/lib/application/fitment/legacy-vehicle-api';
import {listPublicVehicleMakes,listPublicVehicleModels,listPublicVehicleYears} from '@/lib/queries/public-vehicle-catalog';
export const GET=createLegacyVehicleHandler('years',{makes:listPublicVehicleMakes,models:listPublicVehicleModels,years:listPublicVehicleYears});
