"use client";

import { CarFront } from 'lucide-react';
import { useVehicleContext } from '@/components/vehicle-context-provider';
import { vehicleContextDetails, vehicleContextLabel } from '@/lib/vehicle-context';
import { VehicleFinderForm } from '@/components/friendly-vehicle-parts-finder';

export function VehicleSelectionBar() {
  const { vehicle, changing, selectionSession, changeVehicle, cancelChange, selectVehicle, clearVehicle } = useVehicleContext();
  if (!vehicle && !changing) return null;
  return <section id="current-vehicle" aria-label="Current vehicle" className="scroll-mt-40 border-b border-black/10 bg-[#F3F5F7] text-ink">
    <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
      <CarFront className="h-5 w-5 shrink-0 text-signal" aria-hidden/>
      <div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase tracking-[0.12em] text-steel">{vehicle?'Current vehicle':'My vehicle'}</p><p className="mt-0.5 text-sm font-black">{vehicle?vehicleContextLabel(vehicle):'Choose your vehicle'}</p>{vehicle?<p className="mt-0.5 text-xs font-semibold text-steel">{vehicleContextDetails(vehicle)}</p>:null}</div>
      <button type="button" onClick={changing?cancelChange:changeVehicle} aria-expanded={changing} aria-controls="global-vehicle-editor" className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-black/15 bg-white px-3 text-xs font-black text-signal hover:border-signal">{changing?'Cancel':'Change vehicle'}</button>
    </div>
    {changing?<div id="global-vehicle-editor" className="mx-auto max-w-7xl border-t border-black/10 px-4 py-5 sm:px-6 lg:px-8">
      <VehicleFinderForm embedded key={selectionSession} initialVehicle={vehicle} onSelect={selection=>selectVehicle(selection)}/>
      {vehicle?<div className="mt-3 text-right"><button type="button" onClick={()=>clearVehicle()} className="min-h-10 text-xs font-bold text-steel underline">Clear vehicle</button></div>:null}
    </div>:null}
  </section>;
}
