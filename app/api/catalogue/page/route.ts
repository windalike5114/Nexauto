import {createCataloguePageHandler} from '@/lib/application/storefront/catalogue-api';
import {readCataloguePage} from '@/lib/queries/storefront-page';
import {readStoredVehicleContext} from '@/lib/server/vehicle-context';
export const POST=createCataloguePageHandler({read:readCataloguePage,vehicle:readStoredVehicleContext});
