"use client";
import { VehicleFinderForm } from './friendly-vehicle-parts-finder';
import { useVehicleContext } from './vehicle-context-provider';
export { buildVehiclePartsHref } from './friendly-vehicle-parts-finder';

export function VehiclePartsFinder({ compact = false, category }: { compact?: boolean; category?: string } = {}) {
  const { vehicle, ready, changing, selectVehicle } = useVehicleContext();
  if (!ready || vehicle || changing) return null;
  return <VehicleFinderForm compact={compact} onSelect={selection=>selectVehicle(selection,category&&category!=='all'?`/parts?category=${encodeURIComponent(category)}`:'/parts')}/>;
}

export function HomeVehicleFinder() {
  const { vehicle, ready, changing } = useVehicleContext();
  if (!ready || vehicle || changing) return null;
  return <section id="vehicle-finder" className="scroll-mt-40 border-b border-black/10 bg-[#EEF2F5]"><div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8"><VehiclePartsFinder/></div></section>;
}
