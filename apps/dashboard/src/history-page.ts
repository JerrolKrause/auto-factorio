import { useEffect, useRef, useState } from 'react';

type Api = (route: string, body?: unknown) => Promise<unknown>;
type Page<T> = { items: T[]; next: string | null; unavailable?: string };
type Scope<T> = {
  api: Api; route: string | null; retry: number; items: T[]; next: string | null;
  tailCursor: string | null; loaded: boolean; pending: boolean; loading: boolean;
  revision: number; refreshSerial: number; error: string;
};

/** Keep the explicitly loaded prefix; live updates read at most two bounded pages. */
export function useHistoryPage<T>({api,route,refresh,retry,key,compare}: {
  api: Api; route: string | null; refresh: number; retry: number;
  key: (item: T) => string | number; compare: (left: T,right: T) => number;
}) {
  const current = useRef<Scope<T> | null>(null);
  if (!current.current || current.current.api !== api || current.current.route !== route || current.current.retry !== retry) {
    current.current = {api,route,retry,items:[],next:null,tailCursor:null,loaded:false,pending:false,loading:route!==null,revision:0,refreshSerial:0,error:''};
  }
  const scope=current.current;
  const [,render]=useState(0);
  const publish=()=>{if(current.current===scope)render(value=>value+1);};
  const merge=(pages:Page<T>[],refreshPrefix=false)=>{
    const rows=new Map(scope.items.map(item=>[key(item),item]));
    for(const page of pages)for(const item of page.items)rows.set(key(item),item);
    const prefix=refreshPrefix?pages[0]!.items:[];
    const prefixKeys=new Set(prefix.map(key));
    // Some identities intentionally omit ordering timestamps. Preserve the
    // server's refreshed prefix order before the previously requested remainder.
    scope.items=[...prefix.map(item=>rows.get(key(item))!),...[...rows.values()].filter(item=>!prefixKeys.has(key(item)))].sort(compare);
  };
  const address=(cursor:string|null)=>scope.route+(cursor===null?'':`&cursor=${encodeURIComponent(cursor)}`);

  useEffect(()=>{
    if(!route)return;
    const serial=++scope.refreshSerial,revision=scope.revision,tailCursor=scope.tailCursor;
    let retired=false;
    const valid=()=>!retired&&current.current===scope&&scope.refreshSerial===serial;
    void Promise.all([api(address(null)),...(tailCursor===null?[]:[api(address(tailCursor))])]).then(raw=>{
      if(!valid())return;
      const pages=raw as Page<T>[];
      merge(pages,true);scope.loaded=true;scope.error='';
      // A More request may advance while this refresh is in flight. Its cursor
      // wins; the older page can still update rows without rewinding pagination.
      if(scope.revision===revision&&scope.tailCursor===tailCursor)scope.next=pages.at(-1)!.next;
      if(!scope.pending)scope.loading=false;
      publish();
    }).catch(error=>{
      if(!valid())return;
      scope.error=String(error);if(!scope.pending)scope.loading=false;publish();
    });
    return()=>{retired=true;};
  },[api,route,refresh,retry]);

  async function more():Promise<void>{
    if(!scope.route||!scope.loaded||scope.pending||!scope.next)return;
    const cursor=scope.next;
    scope.pending=true;scope.loading=true;scope.error='';scope.revision++;publish();
    try{
      const page=await api(address(cursor)) as Page<T>;
      if(current.current!==scope)return;
      merge([page]);scope.tailCursor=cursor;scope.next=page.next;
    }catch(error){
      if(current.current!==scope)return;
      scope.error=String(error);throw error;
    }finally{
      if(current.current===scope){scope.pending=false;scope.loading=false;publish();}
    }
  }
  return{items:scope.items,next:scope.next,loading:scope.loading,pending:scope.pending,error:scope.error,more};
}
