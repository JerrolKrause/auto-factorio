export interface Position { x: number; y: number }
export interface Item { name: string; quality: string; count: number }
export interface Target { name: string; quality: string; position: Position; unit: number | null }
export type Step =
  | { kind: 'walk'; position: Position }
  | { kind: 'place'; position: Position; item: string; quality: string; direction: number }
  | { kind: 'rotate' | 'mine'; target: Target }
  | { kind: 'recipe'; target: Target; recipe: string }
  | { kind: 'transfer'; target: Target; inventory: 'chest' | 'input' | 'output' | 'fuel'; flow: 'put' | 'take'; item: Item }
  | { kind: 'module'; target: Target; item: Item }
  | { kind: 'filter'; target: Target; slot: number; item: Omit<Item,'count'> | null }
  | { kind: 'bar'; target: Target; inventory: 'chest'; limit: number | null }
  | { kind: 'wire'; target: Target; other: Target; fromConnector: number; toConnector: number }
  | { kind: 'setting'; target: Target; name: 'active'|'inserter_filter_mode'|'splitter_input_priority'|'splitter_output_priority'|'underground_type'; value: string|boolean }
  | { kind: 'craft'; recipe: string; count: number };
export interface Batch {
  commandId: string; epoch: string; session: string; task: string; revision: number;
  actor: string; surface: string; grants: import('./ownership.js').Grant[];
  deadline: number; steps: Step[];
}
export interface Receipt {
  commandId: string; status: 'accepted' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'suspended';
  acceptedTick: number; endedTick?: number; completed: number; unexecuted: number;
  steps: { index: number; status: string; reason?: string; startedTick: number; endedTick: number; before: Item[]; after: Item[]; delta: Item[] }[];
}
export type GameRequest =
  | { op: 'observe'; surface: string; area: [Position, Position]; offset: number; limit: number }
  | { op: 'operational-register'; scope: import('./operational.js').ObservationScope; sampleTicks: number; historySamples: number }
  | { op: 'operational-read'; scopeId: string; scopeRevision: number; afterTick: number }
  | { op: 'recipe'; name: string }
  | { op: 'submit'; batch: Batch }
  | { op: 'receipt'; commandId: string }
  | { op: 'cancel'; commandId: string; epoch: string; session: string };
export function record(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected object'); return v as Record<string, unknown>; }
function keys(v: Record<string, unknown>, allowed: string[]): void { if (Object.keys(v).some(k => !allowed.includes(k)) || allowed.some(k => !(k in v))) throw new Error('Unexpected or missing fields'); }
function integer(v: unknown, min: number, max: number): void { if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) throw new Error('Integer outside bounds'); }
function name(v: unknown): void { if (typeof v !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(v)) throw new Error('Invalid identifier'); }
// Payload validation prevents pathological coordinates; scenario ownership grants
// enforce the tighter playable boundary for each command.
function position(v: unknown): void { const p = record(v); keys(p,['x','y']); for (const n of [p.x,p.y]) if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n)>4096) throw new Error('Position outside assignment'); }
function target(v: unknown): void { const t=record(v); keys(t,['name','quality','position','unit']); name(t.name); name(t.quality); position(t.position); if(t.unit!==null)integer(t.unit,1,2147483647); }
function item(v: unknown): void {const i=record(v); keys(i,['name','quality','count']); name(i.name); name(i.quality); integer(i.count,1,1000);}
export function validateRequest(v: unknown): GameRequest {
  const r=record(v);
  switch(r.op) {
    case 'observe': keys(r,['op','surface','area','offset','limit']); name(r.surface); if(!Array.isArray(r.area)||r.area.length!==2)throw new Error('Invalid area'); r.area.forEach(position); if(r.area[0].x>r.area[1].x||r.area[0].y>r.area[1].y)throw new Error('Reversed area'); integer(r.offset,0,10000); integer(r.limit,1,50); break;
    case 'operational-register': {
      keys(r,['op','scope','sampleTicks','historySamples']); const s=record(r.scope); keys(s,['schema','id','revision','task','surface','area','entityLimit']);
      integer(s.schema,1,1); name(s.id); name(s.task); name(s.surface); integer(s.revision,1,2147483647); integer(s.entityLimit,1,100000);
      if(!Array.isArray(s.area)||s.area.length!==2)throw new Error('Invalid area');s.area.forEach(position);if(s.area[0].x>s.area[1].x||s.area[0].y>s.area[1].y)throw new Error('Reversed area');
      integer(r.sampleTicks,1,3600);integer(r.historySamples,2,10000);break;
    }
    case 'operational-read': keys(r,['op','scopeId','scopeRevision','afterTick']);name(r.scopeId);integer(r.scopeRevision,1,2147483647);integer(r.afterTick,-1,2147483647);break;
    case 'recipe': keys(r,['op','name']); name(r.name); break;
    case 'receipt': keys(r,['op','commandId']); name(r.commandId); break;
    case 'cancel': keys(r,['op','commandId','epoch','session']); name(r.commandId); name(r.epoch); name(r.session); break;
    case 'submit': {
      keys(r,['op','batch']); const b=record(r.batch); keys(b,['commandId','epoch','session','task','revision','actor','surface','grants','deadline','steps']);
      for(const k of ['commandId','epoch','session','task','actor','surface'])name(b[k]); integer(b.revision,1,2147483647); integer(b.deadline,1,2147483647);
      if(!Array.isArray(b.grants)||b.grants.length<3||b.grants.length>32)throw new Error('Incomplete reservation set');
      const ids=new Set();for(const value of b.grants){const g=record(value);keys(g,['id','generation']);name(g.id);integer(g.generation,1,2147483647);if(ids.has(g.id))throw new Error('Duplicate reservation');ids.add(g.id);}
      if(!Array.isArray(b.steps)||b.steps.length<1||b.steps.length>100)throw new Error('Batch must have 1-100 steps');
      for(const value of b.steps){const s=record(value); switch(s.kind){
        case 'walk':keys(s,['kind','position']);position(s.position);break;
        case 'place':keys(s,['kind','position','item','quality','direction']);position(s.position);name(s.item);name(s.quality);integer(s.direction,0,15);break;
        case 'rotate':case 'mine':keys(s,['kind','target']);target(s.target);break;
        case 'recipe':keys(s,['kind','target','recipe']);target(s.target);name(s.recipe);break;
        case 'craft':keys(s,['kind','recipe','count']);name(s.recipe);integer(s.count,1,100);break;
        case 'transfer':keys(s,['kind','target','inventory','flow','item']);target(s.target);item(s.item);if(!['chest','input','output','fuel'].includes(String(s.inventory))||!['put','take'].includes(String(s.flow)))throw new Error('Unsupported transfer');break;
        case 'module':keys(s,['kind','target','item']);target(s.target);item(s.item);break;
        case 'filter':keys(s,['kind','target','slot','item']);target(s.target);integer(s.slot,1,100);if(s.item!==null){const f=record(s.item);keys(f,['name','quality']);name(f.name);name(f.quality);}break;
        case 'bar':keys(s,['kind','target','inventory','limit']);target(s.target);if(s.inventory!=='chest')throw new Error('Unsupported inventory bar');if(s.limit!==null)integer(s.limit,1,1000);break;
        case 'wire':keys(s,['kind','target','other','fromConnector','toConnector']);target(s.target);target(s.other);integer(s.fromConnector,0,255);integer(s.toConnector,0,255);break;
        case 'setting':keys(s,['kind','target','name','value']);target(s.target);if(!['active','inserter_filter_mode','splitter_input_priority','splitter_output_priority','underground_type'].includes(String(s.name))||!['string','boolean'].includes(typeof s.value))throw new Error('Unsupported entity setting');break;
        default:throw new Error('Unsupported action');
      }} break;
    }
    default: throw new Error('Unsupported gameplay operation');
  }
  return v as GameRequest;
}
export interface RecipeFacts { name: string; energy: number; ingredients: {type: string; name: string; amount: number}[]; products: {type: string; name: string; amount?: number; probability?: number; extra_count_fraction?: number}[]; category: string; }
export function requirements(facts: RecipeFacts, output: string, count: number): {supported: false; reason: string} | {supported: true; crafts: number; seconds: number; ingredients: Item[]} {
  if(!Number.isFinite(count)||count<=0)throw new Error('Invalid requested amount');
  if(!['crafting','basic-crafting','advanced-crafting'].includes(facts.category)||facts.products.length!==1||facts.ingredients.some(i=>i.type!=='item')||facts.products.some(p=>p.type!=='item'||!p.amount||p.probability!==undefined&&p.probability!==1||!!p.extra_count_fraction))return {supported:false,reason:'unsupported_rich_recipe'};
  const product=facts.products[0]!;if(product.name!==output)return {supported:false,reason:'output_not_in_recipe'};
  const crafts=Math.ceil(count/product.amount!);return {supported:true,crafts,seconds:crafts*facts.energy,ingredients:facts.ingredients.map(i=>({name:i.name,quality:'normal',count:i.amount*crafts}))};
}

export interface Observation {
  ok: true; epoch: string; session: string; tick: number; ticksPlayed: number; surface: string;
  scope: [Position,Position]; coverage: string; freshness: string; offset: number; total: number;
  nextOffset?: number; truncated: boolean; entities: (Target & {type:string; protected:boolean; direction:number; inventories:Record<string,Item[]>})[];
  actors: Record<string,{position:Position; surface:string; inventory:Item[]; connected:boolean}>; mods:Record<string,string>;
}
/** Reject incomplete receipts before they can resolve an unknown command. */
export function validateReceipt(v: unknown): Receipt | null {
  if(v===undefined||v===null)return null;
  const r=record(v);name(r.commandId);
  if(!['accepted','running','completed','partial','failed','cancelled','suspended'].includes(String(r.status)))throw new Error('Invalid receipt status');
  integer(r.acceptedTick,0,2147483647);integer(r.completed,0,100);integer(r.unexecuted,0,100);
  const steps=Array.isArray(r.steps)?r.steps:Object.keys(record(r.steps)).length===0?[]:null;
  if(!steps)throw new Error('Invalid receipt steps');
  for(const value of steps){const step=record(value);integer(step.index,1,100);integer(step.startedTick,0,2147483647);integer(step.endedTick,Number(step.startedTick),2147483647);if(!['completed','failed','cancelled'].includes(String(step.status)))throw new Error('Invalid step status');for(const field of ['before','after','delta']){const list=step[field];if(!Array.isArray(list)&&(!list||Object.keys(record(list)).length!==0))throw new Error('Invalid receipt inventory');}}
  if(steps.filter(s=>record(s).status==='completed').length!==r.completed)throw new Error('Receipt completion mismatch');
  if(r.status==='completed'&&r.unexecuted!==0)throw new Error('Incomplete completed receipt');
  return {...r,steps} as unknown as Receipt;
}
