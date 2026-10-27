"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { clearVehicleContext, globalVehicleContext, readVehicleContextFromBrowser, sameVehicleContext, saveVehicleContext, vehicleContextChangedEvent, vehicleContextStorageKey, withoutVehicleParams, type VehicleContext } from '@/lib/vehicle-context';

type VehicleState = {
  vehicle: VehicleContext | null;
  ready: boolean;
  changing: boolean;
  selectionSession: number;
  changeVehicle: () => void;
  cancelChange: () => void;
  selectVehicle: (vehicle: VehicleContext, destination?: string) => void;
  clearVehicle: (destination?: string) => void;
};
const Context = createContext<VehicleState | null>(null);

export function useVehicleContext() {
  const context = useContext(Context);
  if (!context) throw new Error('VehicleContextProvider is required.');
  return context;
}

export function VehicleContextProvider({ initialVehicle, children }: { initialVehicle: VehicleContext | null; children: ReactNode }) {
  const router = useRouter();
  const [vehicle, setVehicle] = useState(initialVehicle), [ready, setReady] = useState(false), [changing, setChanging] = useState(false);
  const current = useRef(initialVehicle);
  const [session, setSession] = useState(0);

  const refreshCurrentPage = useCallback((clear = false, destination?: string) => {
    const location = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const next = destination ?? withoutVehicleParams(location, clear);
    if (next !== location) {
      if (destination) router.push(next as never);
      else router.replace(next as never, { scroll: false });
    } else router.refresh();
  }, [router]);

  useEffect(() => {
    // The server has already checked the cookie against the current catalogue.
    if (current.current) saveVehicleContext(current.current);
    else clearVehicleContext();
    setReady(true);
    const sync = () => {
      const next = readVehicleContextFromBrowser();
      if (sameVehicleContext(current.current, next)) return;
      current.current = next; setVehicle(next); setChanging(false);
      if (next) saveVehicleContext(next); else clearVehicleContext();
      refreshCurrentPage(!next);
    };
    const storage = (event: StorageEvent) => { if (event.key === vehicleContextStorageKey || event.key === null) sync(); };
    const hashes = () => {
      if (['#change-vehicle','#refine-vehicle'].includes(window.location.hash)) { setSession(value=>value+1); setChanging(true); }
    };
    hashes();
    window.addEventListener('storage', storage);
    window.addEventListener(vehicleContextChangedEvent, sync);
    window.addEventListener('hashchange', hashes);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener(vehicleContextChangedEvent, sync);
      window.removeEventListener('hashchange', hashes);
    };
  }, [refreshCurrentPage]);

  function close() {
    setChanging(false);
    if (['#change-vehicle','#refine-vehicle'].includes(window.location.hash)) window.history.replaceState(null,'',`${window.location.pathname}${window.location.search}`);
  }
  function changeVehicle() { setSession(value=>value+1); setChanging(true); }
  function selectVehicle(selection: VehicleContext, destination?: string) {
    const complete = globalVehicleContext(selection);
    if (!complete) return;
    current.current = complete; setVehicle(complete);
    saveVehicleContext(complete); close(); refreshCurrentPage(false, destination);
  }
  function clearVehicle(destination?: string) {
    current.current = null; setVehicle(null);
    clearVehicleContext(); close(); refreshCurrentPage(true, destination);
  }

  return <Context.Provider value={{vehicle,ready,changing,selectionSession:session,changeVehicle,cancelChange:close,selectVehicle,clearVehicle}}>
    {children}
  </Context.Provider>;
}
