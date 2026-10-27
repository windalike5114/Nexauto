"use client";

import { VehiclePartsFinder } from '@/components/vehicle-parts-finder';

export function CatalogVehicleSelector({ category }: { category: string; categoryLabel: string }) {
  return <VehiclePartsFinder compact category={category}/>;
}
