export const WORKSHOP_PENDING_KEY='autofactorio.workshop.pending.v1';
export interface PendingWorkshopRequest { schema:1; id:string; assignment:Record<string,unknown>; selectedGroupId:string|null; createdAt:string }
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function readPendingWorkshop(store:Store):PendingWorkshopRequest|null{try{const raw=store.getItem(WORKSHOP_PENDING_KEY);if(!raw)return null;
  const value=JSON.parse(raw) as PendingWorkshopRequest;
  if(value.schema!==1||typeof value.id!=='string'||!value.id||!value.assignment||typeof value.assignment!=='object'||value.assignment.id!==value.id||
    !(typeof value.selectedGroupId==='string'||value.selectedGroupId===null)||!Number.isFinite(Date.parse(value.createdAt)))return null;
  return value;
}catch{return null;}}
export function savePendingWorkshop(store:Store,value:PendingWorkshopRequest):string|null{try{store.setItem(WORKSHOP_PENDING_KEY,JSON.stringify(value));return null;}catch(error){return String(error);}}
export function clearPendingWorkshop(store:Store):string|null{try{store.removeItem(WORKSHOP_PENDING_KEY);return null;}catch(error){return String(error);}}
