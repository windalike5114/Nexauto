import { CarFront, Plus, Trash2 } from "lucide-react";
import { WiperFitmentFinder } from "@/components/wiper-fitment-finder";
import type { AccountVehicle } from "@/components/account/account-types";
import { vehicleLabel } from "@/components/account/account-types";
import { EmptyState, Panel } from "@/components/account/account-ui";

export function VehiclesSection({
  vehicles,
  busyVehicleId,
  setDefaultVehicle,
  removeVehicle,
  findWipers,
  refresh
}: {
  vehicles: AccountVehicle[];
  busyVehicleId: string;
  setDefaultVehicle: (vehicleId: string) => void;
  removeVehicle: (vehicleId: string) => void;
  findWipers: (vehicle: AccountVehicle) => void;
  refresh: () => void;
}) {
  return (
    <section className="mt-6 grid gap-5">
      <Panel title="Saved Vehicles" icon={<CarFront className="h-5 w-5" />}>
        {vehicles.length ? (
          <div className="grid gap-4">
            {vehicles.map((vehicle) => (
              <article key={vehicle.id} className="rounded-lg border border-black/10 bg-zinc-50 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-xl font-black">{vehicleLabel(vehicle)}</h3>
                    {vehicle.label ? <p className="mt-1 text-sm font-bold text-steel">{vehicle.label}</p> : null}
                    {vehicle.isDefault ? <p className="mt-1 text-sm font-black text-signal">Default Vehicle</p> : null}
                    <p className="mt-1 text-xs font-bold text-steel">Last used {new Date(vehicle.lastUsedAt).toLocaleDateString("en-NZ")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => findWipers(vehicle)} disabled={busyVehicleId === vehicle.id} className="h-10 rounded bg-signal px-3 text-sm font-black text-white hover:bg-red-700 disabled:bg-zinc-300">
                      {busyVehicleId === vehicle.id ? "Finding..." : "Find Wipers"}
                    </button>
                    {!vehicle.isDefault ? (
                      <button type="button" onClick={() => setDefaultVehicle(vehicle.id)} disabled={busyVehicleId === vehicle.id} className="h-10 rounded border border-black/10 bg-white px-3 text-sm font-black text-ink hover:border-ink disabled:text-steel">
                        Set as Default
                      </button>
                    ) : null}
                    <button type="button" disabled className="h-10 cursor-not-allowed rounded border border-black/10 bg-white px-3 text-sm font-black text-steel">
                      Edit
                    </button>
                    <button type="button" onClick={() => removeVehicle(vehicle.id)} disabled={busyVehicleId === vehicle.id} className="inline-flex h-10 items-center gap-2 rounded border border-black/10 bg-white px-3 text-sm font-black text-ink hover:border-ink disabled:text-steel">
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState text="No saved vehicles yet." />
        )}
      </Panel>

      <Panel title="Add Another Vehicle" icon={<Plus className="h-5 w-5" />}>
        <WiperFitmentFinder compact onVehicleSaved={refresh} />
      </Panel>
    </section>
  );
}
