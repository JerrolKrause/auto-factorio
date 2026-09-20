import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import type { BlueprintDocument, BlueprintEntity, BlueprintRevisionMetadata, BlueprintWire, Position, WorkshopPort } from '@autofactorio/contracts';

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
};
const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
const finitePosition = (p: Position) => Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=16384&&Math.abs(p.y)<=16384;
const cleanRecord = <T>(value: Record<string,T>|undefined): Record<string,T>|undefined => value ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))) : undefined;

export function normalizeBlueprint(input: BlueprintDocument): BlueprintDocument {
  if (input.schema!==1||!input.label.trim()||input.label.length>200||input.description.length>2000) throw new Error('Invalid blueprint header');
  if (!Array.isArray(input.entities)||input.entities.length<1||input.entities.length>10000) throw new Error('Invalid blueprint entities');
  const ids=new Set<string>();
  const entities=input.entities.map((entity):BlueprintEntity=>{
    if(!/^[\w.-]{1,160}$/.test(entity.id)||ids.has(entity.id)||!/^[-a-z0-9_.]+$/.test(entity.name)||!finitePosition(entity.position)||!Number.isInteger(entity.direction)||entity.direction<0||entity.direction>15||entity.quality!=='normal') throw new Error('Malformed or duplicate blueprint entity'); ids.add(entity.id);
    if(entity.modules&&Object.values(entity.modules).some(v=>!Number.isSafeInteger(v)||v<1||v>100))throw new Error('Invalid blueprint modules');
    if(entity.filters&&entity.filters.some(f=>!Number.isSafeInteger(f.index)||f.index<1||f.quality!=='normal'||!/^[-a-z0-9_.]+$/.test(f.name)))throw new Error('Invalid blueprint filters');
    const settings=cleanRecord(entity.settings); if(settings&&Object.values(settings).some(v=>!['string','number','boolean'].includes(typeof v)))throw new Error('Invalid blueprint settings');
    if(entity.undergroundType!==undefined&&!['input','output'].includes(entity.undergroundType))throw new Error('Invalid underground type');
    return {id:entity.id,entityNumber:0,name:entity.name,position:{x:entity.position.x,y:entity.position.y},direction:entity.direction,quality:'normal',...(entity.recipe?{recipe:entity.recipe}:{}),...(entity.modules?{modules:Object.fromEntries(Object.entries(entity.modules).sort(([a],[b])=>a.localeCompare(b)))}:{}),...(entity.filters?{filters:[...entity.filters].sort((a,b)=>a.index-b.index)}:{}),...(entity.inventoryBar===undefined?{}:{inventoryBar:entity.inventoryBar}),...(settings?{settings}:{}),...(entity.undergroundType===undefined?{}:{undergroundType:entity.undergroundType})};
  }).sort((a,b)=>a.id.localeCompare(b.id)).map((entity,index)=>({...entity,entityNumber:index+1}));
  const wires=input.wires.map(wire=>normalizeWire(wire,ids)).sort((a,b)=>stable(a).localeCompare(stable(b)));
  const ports=input.ports.map(port=>structuredClone(port)).sort((a,b)=>a.id.localeCompare(b.id));
  if(new Set(ports.map(p=>p.id)).size!==ports.length||ports.some(p=>!finitePosition(p.position)))throw new Error('Invalid blueprint ports');
  const icons=[...input.icons].sort((a,b)=>a.index-b.index); if(icons.some(i=>!Number.isSafeInteger(i.index)||i.index<1||!/^[-a-z0-9_.]+$/.test(i.name)))throw new Error('Invalid blueprint icons');
  const tiles=[...input.tiles].map(t=>({name:t.name,position:{...t.position}})).sort((a,b)=>a.position.y-b.position.y||a.position.x-b.position.x||a.name.localeCompare(b.name)); if(tiles.some(t=>!finitePosition(t.position)||!/^[-a-z0-9_.]+$/.test(t.name)))throw new Error('Invalid blueprint tile');
  return {schema:1,label:input.label,description:input.description,entities,wires,ports,icons,tiles};
}
function normalizeWire(wire:BlueprintWire,ids:Set<string>):BlueprintWire{
  if(!ids.has(wire.from.entityId)||!ids.has(wire.to.entityId)||!/^\d{1,3}$/.test(wire.from.connector)||!/^\d{1,3}$/.test(wire.to.connector)||!['copper','red','green'].includes(wire.color))throw new Error('Invalid blueprint wire');
  const left=`${wire.from.entityId}:${wire.from.connector}`,right=`${wire.to.entityId}:${wire.to.connector}`;
  return left<=right?structuredClone(wire):{from:{...wire.to},to:{...wire.from},color:wire.color};
}
export function blueprintContentHash(input:BlueprintDocument):string{
  const content=normalizeBlueprint(input) as Partial<BlueprintDocument>;delete content.label;delete content.description;return hash(content);
}
const turn=(position:Position,quarters:number):Position=>{let{x,y}=position;for(let i=0;i<quarters;i++) [x,y]=[-y,x];return{x,y};};
export function transformBlueprint(input:BlueprintDocument,options:{quarterTurns?:0|1|2|3;translate?:Position;mirror?:boolean}):BlueprintDocument{
  if(options.mirror)throw new Error('Blueprint mirroring is unsupported'); const q=options.quarterTurns??0,t=options.translate??{x:0,y:0};
  const move=(p:Position)=>{const r=turn(p,q);return{x:r.x+t.x,y:r.y+t.y};};
  return normalizeBlueprint({...input,entities:input.entities.map(e=>({...e,position:move(e.position),direction:(e.direction+q*4)%16})),ports:input.ports.map(p=>({...p,position:move(p.position),facing:(p.facing+q*4)%16})),tiles:input.tiles.map(tile=>({...tile,position:move(tile.position)}))});
}
export function billOfMaterials(input:BlueprintDocument):Record<string,number>{
  const result:Record<string,number>={}; for(const entity of normalizeBlueprint(input).entities){result[entity.name]=(result[entity.name]??0)+1;for(const[countName,count]of Object.entries(entity.modules??{}))result[countName]=(result[countName]??0)+count;} return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
}
export function nativeBlueprintObject(input:BlueprintDocument):Record<string,unknown>{
  const value=normalizeBlueprint(input),numbers=new Map(value.entities.map(e=>[e.id,e.entityNumber]));
  return {blueprint:{item:'blueprint',version:562949957025792,label:value.label,description:value.description,icons:value.icons.map(i=>({index:i.index,signal:{type:'item',name:i.name}})),entities:value.entities.map(e=>({entity_number:e.entityNumber,name:e.name,position:e.position,direction:e.direction,quality:e.quality,...(e.recipe?{recipe:e.recipe}:{}),...(e.modules?{items:e.modules}:{}),...(e.filters?{filters:e.filters.map(f=>({...f,comparator:'='}))}:{}),...(e.inventoryBar===undefined?{}:{bar:e.inventoryBar}),...(e.undergroundType?{type:e.undergroundType}:{}),...(e.settings??{})})),tiles:value.tiles,wires:value.wires.map(w=>[numbers.get(w.from.entityId),Number(w.from.connector),numbers.get(w.to.entityId),Number(w.to.connector)])}};
}
export function exportBlueprint(input:BlueprintDocument):string{return '0'+deflateSync(Buffer.from(JSON.stringify(nativeBlueprintObject(input)))).toString('base64');}
export function importBlueprint(encoded:string):BlueprintDocument{
  if(!/^0[A-Za-z0-9+/=]+$/.test(encoded))throw new Error('Malformed blueprint string'); let raw:unknown;try{raw=JSON.parse(inflateSync(Buffer.from(encoded.slice(1),'base64')).toString());}catch{throw new Error('Malformed blueprint string');}
  const root=raw as {blueprint?:Record<string,unknown>};const bp=root.blueprint;if(!bp||!Array.isArray(bp.entities))throw new Error('Unsupported blueprint payload');
  const first=(bp.entities as Record<string,unknown>[])[0];const tags=(first?.tags as {autofactorio?:{ports?:WorkshopPort[];wires?:BlueprintWire[];entityIds?:Record<string,string>}}|undefined)?.autofactorio; const numberToId=tags?.entityIds??{};
  const entities=(bp.entities as Record<string,unknown>[]).map(e=>{const number=Number(e.entity_number),known=new Set(['entity_number','name','position','direction','quality','recipe','items','filters','bar','tags','type']);const settings=Object.fromEntries(Object.entries(e).filter(([k])=>!known.has(k)));return{id:numberToId[String(number)]??`entity-${number}`,entityNumber:number,name:String(e.name),position:e.position as Position,direction:Number(e.direction??0),quality:(e.quality??'normal') as 'normal',...(e.recipe?{recipe:String(e.recipe)}:{}),...(e.items?{modules:e.items as Record<string,number>}:{}),...(Array.isArray(e.filters)?{filters:(e.filters as {index:number;name:string;quality?:string}[]).map(f=>({index:f.index,name:f.name,quality:'normal' as const}))}:{}),...(e.bar===undefined?{}:{inventoryBar:Number(e.bar)}),...(e.type==='input'||e.type==='output'?{undergroundType:e.type}:{}),...(Object.keys(settings).length?{settings:settings as Record<string,string|number|boolean>}:{})};});
  const ids=new Map(entities.map(e=>[e.entityNumber,e.id]));const wires=tags?.wires??(Array.isArray(bp.wires)?bp.wires:[]).map(rawWire=>{const w=rawWire as number[];return{from:{entityId:ids.get(w[0]!)!,connector:String(w[1]!)},to:{entityId:ids.get(w[2]!)!,connector:String(w[3]!)},color:'copper' as const};});
  const icons=Array.isArray(bp.icons)?(bp.icons as {index:number;signal:{name:string}}[]).map(i=>({index:i.index,name:i.signal.name})):[];
  return normalizeBlueprint({schema:1,label:String(bp.label??'Blueprint'),description:String(bp.description??''),entities,wires,ports:tags?.ports??[],icons,tiles:Array.isArray(bp.tiles)?bp.tiles as {name:string;position:Position}[]:[]});
}
export function exportBlueprintBook(label:string,blueprints:BlueprintDocument[]):string{
  if(!label.trim()||!blueprints.length)throw new Error('Invalid blueprint book'); const book={blueprint_book:{item:'blueprint-book',label,active_index:0,version:562949957025792,blueprints:blueprints.map((b,index)=>({index,...nativeBlueprintObject(b)}))}};return'0'+deflateSync(Buffer.from(JSON.stringify(book))).toString('base64');
}
export function sanitizedBundle(document:BlueprintDocument,metadata:BlueprintRevisionMetadata):Record<string,unknown>{
  const clean=normalizeBlueprint(document);return{schema:1,revisionHash:metadata.revisionHash,label:metadata.label,product:metadata.product,profileId:metadata.profileId,gameFingerprint:metadata.gameFingerprint,statuses:metadata.statuses,footprint:metadata.footprint,machines:metadata.machines,rate:metadata.rate,ports:clean.ports,billOfMaterials:billOfMaterials(clean),evidence:metadata.evidence};
}
