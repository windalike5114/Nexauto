"use client";

import { useEffect, useMemo, useState } from 'react';
import { CarFront, Loader2, Search } from 'lucide-react';
import type { VehicleContext } from '@/lib/vehicle-context';
import { groupFriendlyApplications, selectionApplications, sharedVehicleDetails, type FriendlyApplication } from '@/lib/vehicle-variants';
import { groupIdenticalOptions } from '@/lib/vehicle-catalog-display';

type Option = { id: string; name: string };
type Model = Option & { modelIds?: string[] };
type Make = Option;
const requests = new Map<string, Promise<unknown>>();
async function load<T,>(url: string): Promise<T> {
  if (!requests.has(url)) requests.set(url, fetch(url).then(async response => {
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not load vehicles.'); return data;
  }).catch(error => { requests.delete(url); throw error; }));
  return requests.get(url) as Promise<T>;
}

type FinderProps = { compact?: boolean; embedded?: boolean; initialVehicle?: VehicleContext | null; onSelect: (vehicle: VehicleContext) => void };
function optionValue(value: string, options: Option[]) {
  return options.some(option => option.id === value) ? value : options.length === 1 ? options[0].id : '';
}

export function VehicleFinderForm({ compact = false, embedded = false, initialVehicle, onSelect }: FinderProps) {
  const [catalog, setCatalog] = useState<Make[]>([]), [makeId, setMakeId] = useState(initialVehicle?.makeId ?? ''), [modelId, setModelId] = useState(initialVehicle?.modelId ?? ''), [year, setYear] = useState(initialVehicle?.year ?? '');
  const [models,setModels]=useState<Model[]>([]), [years,setYears]=useState<number[]>([]);
  const [modelsLoading,setModelsLoading]=useState(false), [yearsLoading,setYearsLoading]=useState(false);
  const [applications, setApplications] = useState<FriendlyApplication[]>([]), [groupId, setGroupId] = useState(initialVehicle?.variantGroup ?? ''), [code, setCode] = useState('');
  const [mode,setMode]=useState<'quick'|'professional'>('quick');
  const [completing, setCompleting] = useState(false);
  const detailed = mode === 'professional' || completing;
  const [series,setSeries]=useState(''),[engine,setEngine]=useState(''),[variant,setVariant]=useState('');
  useEffect(()=>{if(window.localStorage.getItem('nexauto.finder-mode.v1')==='professional')setMode('professional');},[]);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => { let active = true; load<{ makes: Make[] }>('/api/vehicles/catalog').then(data => { if (active) setCatalog(data.makes); }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  useEffect(()=>{
    let active=true; setModels([]); setModelsLoading(Boolean(makeId));
    if (makeId) load<{models:Model[]}>(`/api/vehicles/catalog?makeId=${encodeURIComponent(makeId)}`)
      .then(data=>{if(active)setModels(data.models);}).catch(error=>{if(active)setError(error.message);}).finally(()=>{if(active)setModelsLoading(false);});
    return ()=>{active=false;};
  },[makeId]);
  useEffect(()=>{
    let active=true; setYears([]); setYearsLoading(Boolean(makeId&&modelId));
    if(makeId&&modelId) load<{years:number[]}>(`/api/vehicles/catalog?makeId=${encodeURIComponent(makeId)}&modelId=${encodeURIComponent(modelId)}`)
      .then(data=>{if(active)setYears(data.years);}).catch(error=>{if(active)setError(error.message);}).finally(()=>{if(active)setYearsLoading(false);});
    return ()=>{active=false;};
  },[makeId,modelId]);
  const model = models.find(model => model.id === modelId || model.modelIds?.includes(modelId));
  const busy=loading||modelsLoading||yearsLoading;
  const sameVehicle = initialVehicle?.makeId === makeId && initialVehicle.modelId === modelId && initialVehicle.year === year;
  useEffect(() => {
    setApplications([]); setError('');
    if (!makeId || !modelId || !year) return;
    let active = true; setLoading(true);
    load<{ applications: FriendlyApplication[] }>(`/api/vehicles/applications?makeId=${makeId}&modelId=${modelId}&year=${year}&catalog=friendly-20261027`).then(data => { if (active) { setApplications(data.applications); if (!data.applications.length) setError('No vehicle configurations found for this year.'); } }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [makeId, modelId, year]);
  const candidates = useMemo(() => {
    const term = code.trim().toUpperCase();
    return term ? applications.filter(app => `${app.seriesName} ${app.engine}`.toUpperCase().split(/[^A-Z0-9]+/).some(token => token === term)) : applications;
  }, [applications, code]);
  const groups = useMemo(() => groupFriendlyApplications(candidates), [candidates]);
  const savedMembers = useMemo(() => sameVehicle && initialVehicle ? selectionApplications(applications, initialVehicle) : [], [applications, sameVehicle, initialVehicle]);
  const initialGroup = savedMembers.length ? groups.find(group => savedMembers.every(app => group.applications.some(member => member.id === app.id))) : undefined;
  const selectedGroupId = optionValue(groupId || initialGroup?.id || '', groups);
  const group = groups.find(group => group.id === selectedGroupId);
  const professionalApplications = group?.applications ?? applications;
  const initialExact = savedMembers.length === 1 ? savedMembers[0] : undefined;
  const seriesOptions=useMemo(()=>groupIdenticalOptions(professionalApplications.map(app=>({id:app.seriesId||'none',name:app.seriesName||'Not specified'}))),[professionalApplications]);
  const selectedSeries = optionValue(series || seriesOptions.find(option => option.ids.includes(initialExact?.seriesId || ''))?.id || '', seriesOptions);
  const seriesMembers=useMemo(()=>professionalApplications.filter(app=>seriesOptions.find(option=>option.id===selectedSeries)?.ids.includes(app.seriesId||'none')),[professionalApplications,seriesOptions,selectedSeries]);
  const engineOptions=useMemo(()=>[...new Map(seriesMembers.map(app=>[app.powertrainId,{id:app.powertrainId,name:app.engine}])).values()],[seriesMembers]);
  const selectedEngine = optionValue(engine || initialExact?.powertrainId || '', engineOptions);
  const engineMembers=useMemo(()=>seriesMembers.filter(app=>app.powertrainId===selectedEngine),[seriesMembers,selectedEngine]);
  const variantOptions=useMemo(()=>[...new Map(engineMembers.map(app=>[app.variantId,{id:app.variantId,name:[app.variantName,app.variantName.toLowerCase().includes(app.driveType.toLowerCase()) ? '' : app.driveType].filter(Boolean).join(' · ')}])).values()],[engineMembers]);
  const selectedVariant = optionValue(variant || initialExact?.variantId || '', variantOptions);
  const professionalMembers=engineMembers.filter(app=>app.variantId===selectedVariant);
  const selectedMembers=detailed?professionalMembers:group?.applications??[];
  function changeMode(next:'quick'|'professional'){setMode(next);setCompleting(false);window.localStorage.setItem('nexauto.finder-mode.v1',next);}
  function resetDetails() { setGroupId(''); setCode(''); setSeries(''); setEngine(''); setVariant(''); setCompleting(false); }
  function findParts() {
    if (!selectedMembers.length || !model || !catalog.some(make => make.id === makeId)) return;
    if (!detailed && selectedMembers.length > 1) { setCompleting(true); return; }
    if (selectedMembers.length !== 1) return;
    const exact = selectedMembers.length === 1 ? selectedMembers[0] : null;
    const versionName=groupFriendlyApplications(selectedMembers).map(group=>group.name).join(' / ');
    const context: VehicleContext = { makeId, modelId, year, make: catalog.find(make => make.id === makeId)!.name, model: model!.name,
      versionLabel: versionName, bodyConfiguration: versionName,
      applicationId: exact?.id, applicationIds: selectedMembers.map(app => app.id),
      generationId: exact?.seriesId ?? undefined, variantId: exact?.variantId, ...sharedVehicleDetails(selectedMembers) };
    onSelect(context);
  }
  return <section className={embedded?'text-ink':`${compact ? 'rounded-xl p-3 sm:p-4' : 'rounded-2xl p-4 sm:p-5'} border border-black/10 bg-white text-ink shadow-panel`}>
    {!embedded?<div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-signal"><CarFront className="h-4 w-4" /> My Vehicle</div>:null}
    <h2 className={embedded&&!completing?'sr-only':`${compact ? 'mt-1 text-base' : 'mt-1 text-xl'} font-black`}>{completing ? 'Complete your vehicle' : 'Find compatible parts'}</h2>
    <div className="mt-3 inline-flex rounded-lg border border-black/10 bg-zinc-50 p-1" role="group" aria-label="Vehicle search mode"><button type="button" aria-pressed={mode==='quick'} onClick={()=>changeMode('quick')} className={`rounded-md px-3 py-2 text-xs font-black ${mode==='quick'?'bg-ink text-white':'text-steel'}`}>Quick search</button><button type="button" aria-pressed={mode==='professional'} onClick={()=>changeMode('professional')} className={`rounded-md px-3 py-2 text-xs font-black ${mode==='professional'?'bg-ink text-white':'text-steel'}`}>Professional search</button></div>
    {completing?<p className="mt-3 text-xs font-bold text-steel">{group?.name}</p>:null}
    <div className={`mt-4 grid gap-3 ${compact ? 'grid-cols-2' : detailed?'sm:grid-cols-3 xl:grid-cols-6':'sm:grid-cols-2 xl:grid-cols-4'}`}>
      <Select label="Make" value={makeId} options={catalog} disabled={!catalog.length} onChange={value => { setMakeId(value); setModelId(''); setYear(''); resetDetails(); }} />
      <Select label="Model" value={model?.id ?? ''} options={models} disabled={!makeId||modelsLoading} onChange={value => { setModelId(value); setYear(''); resetDetails(); }} />
      <Select label="Year" value={year} options={years.map(year => ({ id: String(year), name: String(year) }))} disabled={!modelId||yearsLoading} onChange={value => {setYear(value); resetDetails();}} />
      {!detailed?<Select label="Vehicle version" value={selectedGroupId} options={groups} disabled={!year || busy} onChange={value => {setGroupId(value);setSeries('');setEngine('');setVariant('');}} />:<><Select label="Series" value={selectedSeries} options={seriesOptions} disabled={!year||busy} onChange={value=>{setSeries(value);setEngine('');setVariant('');}}/><Select label="Engine" value={selectedEngine} options={engineOptions} disabled={!selectedSeries||busy} onChange={value=>{setEngine(value);setVariant('');}}/><Select label="Variant" value={selectedVariant} options={variantOptions} disabled={!selectedEngine||busy} onChange={setVariant}/></>}
    </div>
    {!detailed?<details className="mt-3 text-xs font-bold text-steel"><summary className="cursor-pointer">Use chassis or engine code</summary><label className="mt-2 block">Exact code<input aria-label="Chassis or engine code" value={code} onChange={event => setCode(event.target.value)} placeholder="e.g. NZE161 or 1NZ-FE" className="mt-1 h-10 w-full rounded-lg border border-black/15 px-3 text-ink" /></label>{code && !candidates.length ? <p className="mt-2">No matching code for this year.</p> : null}</details>:null}
    <button type="button" disabled={!selectedMembers.length || (detailed && selectedMembers.length !== 1) || !model || busy} onClick={findParts} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-signal px-5 text-sm font-black text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-zinc-300">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {!detailed&&selectedMembers.length>1?'Continue':'Use this vehicle'}</button>
    {detailed&&selectedMembers.length>1?<p role="status" className="mt-3 text-xs font-bold text-steel">This configuration needs further checking. Please contact us for help.</p>:null}
    {error ? <p role="alert" className="mt-3 text-sm font-bold text-signal">{error}</p> : null}
  </section>;
}
function Select({ label, value, options, disabled, onChange }: { label: string; value: string; options: Option[]; disabled: boolean; onChange: (value: string) => void }) {
  return <label className="min-w-0 text-xs font-black text-steel"><span>{label}</span><select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-black/10 bg-white px-2 text-sm font-bold text-ink disabled:bg-zinc-100"><option value="">Select {label.toLowerCase()}</option>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>;
}
export function buildVehiclePartsHref(context: VehicleContext | null, category?: string) {
  if (!context) return '';
  const query = new URLSearchParams({ makeId: context.makeId, modelId: context.modelId, year: context.year });
  if (context.variantGroup) query.set('variantGroup', context.variantGroup);
  else if (context.applicationIds?.length) query.set('applicationIds', context.applicationIds.join(','));
  else if (context.applicationId) query.set('applicationId', context.applicationId);
  if (category && category !== 'all') query.set('category', category);
  return `/parts?${query}`;
}
