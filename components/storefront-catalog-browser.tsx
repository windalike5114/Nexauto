"use client";

import Image from 'next/image';
import Link from 'next/link';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Search, SlidersHorizontal } from 'lucide-react';
import { VehiclePartsFinder } from '@/components/vehicle-parts-finder';
import { useVehicleContext } from '@/components/vehicle-context-provider';
import { formatMoney } from '@/lib/catalog';
import { catalogueCategories } from '@/lib/storefront-catalog';
import { catalogueRequestFromLocation,catalogueFilterKey,catalogueVehicleKey,type CataloguePage,type PublicCatalogueEntry } from '@/lib/storefront-page';

type Props = { initialPage:CataloguePage };
type PaginationState = { key:string;page:number };
const PAGE_SIZE=24;
export function StorefrontCatalogBrowser({initialPage}:Props){
  const {vehicle}=useVehicleContext();
  const search=useSearchParams(),searchText=search.toString();
  const vehicleKey=catalogueVehicleKey(vehicle);
  const baseRequest=useMemo(()=>catalogueRequestFromLocation(Object.fromEntries(new URLSearchParams(searchText)),1,Boolean(vehicleKey)),[searchText,vehicleKey]);
  const {category,query,sort,facets:selectedFacets}=baseRequest,scope=baseRequest.fit;
  const filterKey=catalogueFilterKey(baseRequest,vehicle);
  const [pagination,setPagination]=useState<PaginationState>({key:'',page:1});
  const desiredPage=pagination.key===filterKey?pagination.page:1;
  const requestKey=filterKey+':'+desiredPage;
  const [revision,setRevision]=useState(0);
  const [loaded,setLoaded]=useState({key:initialPage.filterKey+':'+initialPage.page,revision:0,data:initialPage});
  const [failure,setFailure]=useState({key:'',message:'',retryAt:0});
  const fetchKey=requestKey+':'+revision;
  const shown=loaded.key===requestKey&&loaded.revision===revision?loaded.data:null;
  const loading=!shown&&failure.key!==fetchKey;
  const error=failure.key===fetchKey?failure.message:shown?.error??'';
  const visible=shown?.items??[],total=shown?.total??0,page=shown?.page??desiredPage;
  const totalPages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const facets=shown?.facets??[];
  const recommendations=scope&&category!=='all'?catalogueCategories.filter(([id])=>id!=='all'&&id!==category&&(shown?.counts[id]??0)>0).slice(0,3):[];
  const label=catalogueCategories.find(([id])=>id===category)![1];
  const resultsRef=useRef<HTMLElement>(null),statusRef=useRef<HTMLParagraphElement>(null);

  useEffect(()=>{
    const restore=()=>{
      const saved=window.history.state?.nexautoCataloguePage;
      setPagination(saved?.key===filterKey&&Number.isInteger(saved.page)&&saved.page>0?{key:filterKey,page:saved.page}:{key:filterKey,page:1});
    };
    restore();window.addEventListener('popstate',restore);
    return()=>window.removeEventListener('popstate',restore);
  },[filterKey]);
  useEffect(()=>{
    if(!search.has('page'))return;
    const current=new URL(window.location.href);current.searchParams.delete('page');
    window.history.replaceState(window.history.state,'',current.pathname+current.search+current.hash);
  },[search]);
  useEffect(()=>{
    if(loaded.key===requestKey&&loaded.revision===revision)return;
    const controller=new AbortController();let active=true;
    setFailure({key:'',message:'',retryAt:0});
    const identity=new URLSearchParams();
    if(vehicle){identity.set('makeId',vehicle.makeId);identity.set('modelId',vehicle.modelId);}
    fetch('/api/catalogue/page'+(identity.size?'?'+identity:''),{
      method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,
      headers:{'Content-Type':'application/json'},body:JSON.stringify({...baseRequest,page:desiredPage})
    }).then(async response=>{
      const data=await response.json();
      if(!response.ok){
        const wait=response.status===429||response.status===503?Number(response.headers.get('retry-after'))||10:0;
        throw Object.assign(new Error(typeof data.error==='string'?data.error:'Could not load products.'),{retryAfter:wait});
      }
      if(data.pageSize!==24||!Array.isArray(data.items)||data.items.length>24||data.selectionKey!==vehicleKey||data.filterKey!==filterKey)throw new Error('Your selection has changed. Please try again.');
      if(!active)return;
      setLoaded({key:filterKey+':'+data.page,revision,data});
      if(data.page!==desiredPage){
        setPagination({key:filterKey,page:data.page});
        window.history.replaceState({...window.history.state,nexautoCataloguePage:{key:filterKey,page:data.page}},'');
      }
    }).catch(error=>{
      if(!active||controller.signal.aborted)return;
      setFailure({key:fetchKey,message:error instanceof Error?error.message:'Could not load products. Please try again.',retryAt:Date.now()+Math.max(0,error.retryAfter||0)*1000});
    });
    return()=>{active=false;controller.abort();};
  },[requestKey,revision,loaded.key,loaded.revision,vehicleKey,filterKey,desiredPage,baseRequest,vehicle,fetchKey]);
  useEffect(()=>{
    if(!failure.retryAt)return;
    const timer=window.setTimeout(()=>setFailure(previous=>({...previous,retryAt:0})),Math.max(0,failure.retryAt-Date.now()));
    return()=>window.clearTimeout(timer);
  },[failure.retryAt]);
  function url(changes:Record<string,string|null>){
    const next=new URLSearchParams(search.toString());next.delete('page');
    if(scope)next.set('fit','vehicle');
    for(const [key,value]of Object.entries(changes)){if(value)next.set(key,value);else next.delete(key);}
    return '/shop'+(next.size?'?'+next:'');
  }
  function navigate(changes:Record<string,string|null>){
    setPagination({key:'',page:1});setRevision(0);
    window.history.pushState(null,'',url(changes));
  }
  function changePage(value:number){
    const next=Math.min(totalPages,Math.max(1,value));if(next===page||loading)return;
    const state={key:filterKey,page:next};setPagination(state);
    window.history.replaceState({...window.history.state,nexautoCataloguePage:state},'');
    window.requestAnimationFrame(()=>{
      statusRef.current?.focus({preventScroll:true});
      resultsRef.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    });
  }
  function categoryChange(value:string){
    const changes:Record<string,string|null>={category:value==='all'?null:value};
    for(const key of search.keys())if(key.startsWith('f.'))changes[key]=null;
    navigate(changes);
  }
  const filters = <div className="space-y-5">
    <nav aria-label="Catalogue categories" className="space-y-1"><h2 className="mb-3 text-sm font-black">Categories</h2>{catalogueCategories.map(([id,name])=><button key={id} onClick={()=>categoryChange(id)} aria-current={id===category?'page':undefined} className={`flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm font-bold ${id===category?'bg-signal/5 text-signal':'text-steel hover:bg-black/5'}`}><span>{name}</span><span className="ml-2 text-xs">{shown?.counts[id]??'…'}</span></button>)}</nav>
    {facets.map(facet=><label key={facet.key} className="block text-xs font-black text-steel">{facet.label}<select aria-label={facet.label} value={selectedFacets[facet.key]??''} onChange={event=>navigate({['f.'+facet.key]:event.target.value||null})} className="mt-2 h-11 w-full rounded-lg border border-black/10 bg-white px-3 text-sm text-ink"><option value="">All</option>{facet.values.map(value=><option key={value}>{value}</option>)}</select></label>)}
    {Object.keys(selectedFacets).length?<button className="text-xs font-black underline" onClick={()=>navigate(Object.fromEntries(Object.keys(selectedFacets).map(key=>['f.'+key,null])))}>Clear product filters</button>:null}
  </div>;
  return <main className="min-h-screen bg-[#F8FAFC] text-ink">
    <section className="bg-ink text-white"><div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 sm:py-8 lg:px-8"><nav className="text-xs font-bold text-white/60" aria-label="Breadcrumb"><Link href="/">Home</Link> / <Link href="/shop">Shop</Link>{category!=='all'?` / ${label}`:''}</nav><h1 className="mt-4 text-3xl font-black sm:text-4xl">{category==='all'?(scope?'Parts for your vehicle':'Shop all parts'):label}</h1></div></section>
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {vehicle?<section className="mb-5 flex items-center justify-end gap-3" aria-label="Catalogue vehicle filter"><span className="text-xs font-black">Show confirmed fits only</span><button role="switch" aria-label="Show confirmed fits only" aria-checked={scope} onClick={()=>navigate({fit:scope?null:'vehicle'})} className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-xs font-black ${scope?'border-emerald-700/25 bg-emerald-50 text-emerald-800':'border-black/15 bg-white text-steel'}`}><span aria-hidden className={`h-3 w-3 rounded-full ${scope?'bg-emerald-700':'bg-steel'}`}/>{scope?'ON':'OFF'}</button></section>:<div className="mb-6"><VehiclePartsFinder category={category}/></div>}
      {error?<div role="alert" className="mb-5 rounded-lg border border-amber-700/20 bg-amber-50 p-4 text-sm font-bold text-amber-950">{error}<button type="button" disabled={failure.retryAt>Date.now()} onClick={()=>setRevision(value=>value+1)} className="ml-3 underline disabled:opacity-50">{failure.retryAt>Date.now()?'Please wait before retrying':'Try again'}</button></div>:null}
      <div className="grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="hidden rounded-xl border border-black/10 bg-white p-4 shadow-sm lg:block lg:self-start">{filters}</aside>
        <section ref={resultsRef} aria-label="Product results" aria-busy={loading} className="min-w-0 scroll-mt-44">
          <details className="mb-4 rounded-xl border border-black/10 bg-white p-4 lg:hidden"><summary className="flex cursor-pointer items-center gap-2 text-sm font-black"><SlidersHorizontal className="h-4 w-4"/>Filters</summary><div className="mt-5">{filters}</div></details>
          <form onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);navigate({q:String(data.get('q')||'')||null,sort:String(data.get('sort')||'featured')});}} key={`${query}-${sort}`} className="mb-5 flex flex-wrap gap-2 rounded-xl border border-black/10 bg-white p-3 shadow-sm">
            <div className="flex w-full min-w-0 items-center rounded-lg border border-black/15 sm:w-auto sm:flex-1"><Search className="ml-3 h-4 w-4 shrink-0 text-steel"/><input type="search" name="q" aria-label="Search this catalogue" defaultValue={query} placeholder="Part name, specification or SKU" className="h-11 min-w-0 flex-1 rounded-lg px-3 text-sm font-semibold outline-none"/></div><select name="sort" aria-label="Sort products" defaultValue={sort} className="h-11 max-w-full rounded-lg border border-black/15 bg-white px-2 text-xs font-bold"><option value="featured">Featured</option><option value="price-asc">Price: Low to high</option><option value="price-desc">Price: High to low</option><option value="name-asc">Name: A–Z</option></select><button className="h-11 rounded-lg bg-ink px-4 text-xs font-black text-white">Apply</button>
          </form>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p ref={statusRef} tabIndex={-1} className="text-xs font-bold text-steel outline-none sm:text-sm" role="status">{loading?'Loading products…':total} {!loading&&scope?(total===1?'confirmed match':'confirmed matches'):!loading?(total===1?'product':'products'):''}{total>PAGE_SIZE?` · ${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,total)}`:''}</p><CataloguePagination label="Product pagination" page={page} totalPages={totalPages} onChange={changePage}/></div>
          {loading?<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Loading products">{Array.from({length:24},(_,i)=><div key={i} className="h-64 animate-pulse rounded-lg bg-zinc-200"/>)}</div>:visible.length?<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{visible.map(entry=><CatalogueCard key={entry.id} entry={entry}/>)}</div>:<div className="rounded-xl border border-black/10 bg-white p-7 shadow-sm"><h2 className="text-xl font-black">{scope?'No confirmed matches in this selection':'No products found'}</h2><div className="mt-5 flex flex-wrap gap-3"><button onClick={()=>navigate({fit:null})} className="rounded-lg bg-ink px-4 py-3 text-sm font-black text-white">Browse this category</button>{query||Object.keys(selectedFacets).length?<button onClick={()=>navigate({q:null,...Object.fromEntries(Object.keys(selectedFacets).map(key=>['f.'+key,null]))})} className="rounded-lg border border-black/15 px-4 py-3 text-sm font-black">Clear filters</button>:null}<Link href="/contact" className="px-3 py-3 text-sm font-black text-signal">Find a part</Link></div></div>}
          {totalPages>1?<div className="mt-6 flex justify-center"><CataloguePagination label="Product pagination bottom" page={page} totalPages={totalPages} onChange={changePage}/></div>:null}
          {recommendations.length?<section className="mt-8 border-t border-black/10 pt-6"><h2 className="text-xl font-black">More for your vehicle</h2><div className="mt-4 flex flex-wrap gap-3">{recommendations.map(([id,name])=><button key={id} onClick={()=>categoryChange(id)} className="rounded-lg border border-black/15 bg-white px-4 py-3 text-sm font-black">{name} <span className="ml-2 text-steel">{shown?.counts[id]}</span></button>)}</div></section>:null}
        </section>
      </div>
    </div>
  </main>;
}
function CatalogueCard({ entry }: { entry: PublicCatalogueEntry }) {
  const specs = [entry.attributes.position?.join(' / '),entry.attributes['Bulb model']?.join(' / '),entry.attributes.Voltage?.join(' / '),entry.attributes.Power?.join(' / '),entry.attributes.filter_type?.join(' / ')].filter(Boolean).join(' · ');
  return <Link href={entry.href as never} prefetch={false} className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel">
    <div className="relative aspect-[4/3] shrink-0 bg-zinc-100"><Image src={entry.image} alt={entry.name} fill sizes="(min-width: 1280px) 237px, (min-width: 1024px) calc(25vw - 84px), (min-width: 640px) 31vw, 47vw" className="object-contain p-3"/></div>
    <div className="flex flex-1 flex-col p-2.5 sm:p-3">
      {entry.status==='fits'?<p className="mb-1.5 flex items-center gap-1 text-[10px] font-black leading-4 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5 shrink-0"/>Fits your vehicle</p>:entry.status==='conditional'?<p className="mb-1.5 flex items-center gap-1 text-[10px] font-black leading-4 text-amber-800"><CircleHelp className="h-3.5 w-3.5 shrink-0"/>Check configuration</p>:null}
      <p className="truncate text-[10px] font-black tracking-wider text-signal">{entry.sku}</p>
      <h3 title={entry.name} className="mt-1 line-clamp-3 min-h-[3.375rem] text-[13px] font-black leading-[1.125rem] sm:text-sm">{entry.name}</h3>
      {specs?<p title={specs} className="mt-1.5 line-clamp-1 text-[11px] font-bold leading-4 text-steel">{specs}</p>:null}
      {entry.condition?<p title={`Listed for: ${entry.condition}`} className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-steel">Listed for: {entry.condition}</p>:null}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3"><span className="text-lg font-black">{entry.price > 0 ? formatMoney(entry.price) : 'Enquire'}</span><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-zinc-100 group-hover:bg-signal group-hover:text-white"><span className="sr-only">View details</span><ArrowRight className="h-3.5 w-3.5"/></span></div>
    </div>
  </Link>;
}

function CataloguePagination({ label, page, totalPages, onChange }: { label: string; page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages<=1) return null;
  const nearby = page<=3 ? [2,3,4] : page>=totalPages-2 ? [totalPages-3,totalPages-2,totalPages-1] : [page-1,page,page+1];
  const pages = totalPages<=7 ? Array.from({length:totalPages},(_,index)=>index+1) : [...new Set([1,...nearby,totalPages])].filter(value=>value>0&&value<=totalPages).sort((a,b)=>a-b);
  const button = 'inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-2 text-xs font-black transition disabled:cursor-default disabled:opacity-30';
  return <nav aria-label={label} className="flex flex-wrap items-center gap-1.5">
    <button type="button" aria-label="Previous page" disabled={page===1} onClick={()=>onChange(page-1)} className={`${button} border-black/10 bg-white hover:border-black/30`}><ChevronLeft className="h-4 w-4"/></button>
    {pages.map((value,index)=><Fragment key={value}>{index>0&&value-pages[index-1]>1?<span aria-hidden className="px-1 text-xs text-steel">…</span>:null}<button type="button" aria-label={`Page ${value}`} aria-current={value===page?'page':undefined} onClick={()=>onChange(value)} className={`${button} ${value===page?'border-ink bg-ink text-white':'border-black/10 bg-white text-ink hover:border-black/30'}`}>{value}</button></Fragment>)}
    <button type="button" aria-label="Next page" disabled={page===totalPages} onClick={()=>onChange(page+1)} className={`${button} border-black/10 bg-white hover:border-black/30`}><ChevronRight className="h-4 w-4"/></button>
  </nav>;
}
