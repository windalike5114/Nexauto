"use client";

import { CheckCircle2, CircleHelp } from 'lucide-react';
import { useVehicleContext } from '@/components/vehicle-context-provider';
import { sameVehicleContext, type VehicleContext } from '@/lib/vehicle-context';

export function ProductVehicleFitment({ checkedVehicle, status }: { checkedVehicle: VehicleContext | null; status: string }) {
  const { vehicle, changeVehicle } = useVehicleContext();
  const current = sameVehicleContext(vehicle, checkedVehicle);
  const fits = Boolean(vehicle && current && status === 'fits');
  const message = fits ? 'Fits your selected vehicle' : vehicle && !current ? 'Checking compatibility…' : 'Check vehicle fitment';
  return <section aria-label="Product vehicle compatibility" className={`flex items-center gap-3 rounded-lg border p-3 text-sm font-bold ${fits?'border-emerald-700/20 bg-emerald-50 text-emerald-800':'border-black/10 bg-zinc-50 text-steel'}`}>
    {fits?<CheckCircle2 className="h-5 w-5 shrink-0"/>:<CircleHelp className="h-5 w-5 shrink-0"/>}
    <p className="min-w-0 flex-1">{message}</p>
    {!vehicle?<button type="button" onClick={changeVehicle} className="min-h-10 shrink-0 text-xs font-black text-signal underline">Select vehicle</button>:null}
  </section>;
}
