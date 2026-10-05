import { object } from '../../packages/codex/src/protocol.js';

/** Expand bounded declarative repetition, never execute model-authored code. */
export function expandDesignerEntities(source:Record<string,unknown>):unknown[]{
  const entities:unknown[]=Array.isArray(source.entities)?[...source.entities]:[];
  if(source.entityGroups!==undefined&&!Array.isArray(source.entityGroups))throw new Error('entityGroups must be an array');
  const groups=source.entityGroups as unknown[]|undefined;
  if((groups?.length??0)>1000)throw new Error('Too many entity groups');
  for(const raw of groups??[]){
    const group=object(raw),count=Number(group.count),step=object(group.step);
    if(!Number.isSafeInteger(count)||count<1||count>2000||!Number.isFinite(step.x)||!Number.isFinite(step.y)||!Array.isArray(group.entities)||!group.entities.length)throw new Error('Invalid entity group');
    if(entities.length+count*group.entities.length>10000)throw new Error('Designer entity limit exceeded');
    for(let index=0;index<count;index++)for(const template of group.entities){
      const entity=object(template),position=object(entity.position);
      if(!Number.isFinite(position.x)||!Number.isFinite(position.y))throw new Error('Invalid entity group position');
      // Expansion owns identity. Template IDs cannot collide across repetitions.
      const {id: _id,entityNumber: _number,entity_number: _native,...fields}=entity;
      void _id;void _number;void _native;
      entities.push({...fields,position:{x:Number(position.x)+index*Number(step.x),y:Number(position.y)+index*Number(step.y)}});
    }
  }
  if(entities.length>10000)throw new Error('Designer entity limit exceeded');
  return entities;
}

/** Native wire references retain their numbers; generated rows use unused identities. */
export function assignDesignerIdentities(expanded:unknown[]):Record<string,unknown>[] {
  const rows=expanded.map(object),numbers=new Set<number>(),ids=new Set<string>();
  for(const row of rows){
    const raw=row.entityNumber??row.entity_number;
    if(raw!==undefined){
      const number=Number(raw);
      if(!Number.isSafeInteger(number)||number<1||numbers.has(number))throw new Error('Invalid or duplicate designer entity number');
      if(row.entityNumber!==undefined&&row.entity_number!==undefined&&Number(row.entityNumber)!==Number(row.entity_number))throw new Error('Conflicting designer entity numbers');
      numbers.add(number);
    }
    if(row.id!==undefined){const id=String(row.id);if(ids.has(id))throw new Error('Duplicate designer entity ID');ids.add(id);}
  }
  let next=1;
  return rows.map(row=>{
    let number=Number(row.entityNumber??row.entity_number);
    if(row.entityNumber===undefined&&row.entity_number===undefined){while(numbers.has(next))next++;number=next++;numbers.add(number);}
    let id=String(row.id??`entity-${number}`);
    if(row.id===undefined){let suffix=1;while(ids.has(id))id=`entity-${number}-${suffix++}`;ids.add(id);}
    return {...row,id,entityNumber:number};
  });
}

/** Keep measured facts visible instead of burying them behind thousands of rows. */
export function summarizeDesignerDiagnostics(value:unknown):unknown {
  if(!value||typeof value!=='object')return value;
  const data=object(value),rows=Array.isArray(data.diagnostics)?data.diagnostics:[];
  const groups=new Map<string,{name:string;status:string;count:number;examples:unknown[]}>();
  for(const raw of rows){const row=object(raw),name=String(row.name),status=String(row.status),key=`${name}:${status}`;let group=groups.get(key);if(!group){group={name,status,count:0,examples:[]};groups.set(key,group);}group.count++;if(group.examples.length<2)group.examples.push(row);}
  // Triage priority is not a verdict: a healthy saturated design also has waiting inserters.
  const priority=(status:string)=>({no_power:0,low_power:0,no_fuel:0,fluid_ingredient_shortage:1,item_ingredient_shortage:1,full_output:2,waiting_for_space_in_destination:3,waiting_for_source_items:4,working:9,normal:9}[status]??5);
  const ordered=[...groups.values()].sort((a,b)=>priority(a.status)-priority(b.status)||b.count-a.count||a.name.localeCompare(b.name)||a.status.localeCompare(b.status));
  return {totalRows:rows.length,groups:ordered.slice(0,20),omittedGroups:Math.max(0,groups.size-20),sampled:true,interpretation:'Point-in-time states ordered for diagnosis, not proof of a bottleneck. Correlate with measured windows, inventories and inserter endpoints; waiting can be normal.',fixtures:data.fixtures};
}

export const repetitionInstructions='For repeated rows, prefer compact entityGroups:[{count:positiveInteger,step:{x:dx,y:dy},entities:[{name,position:{x,y},direction,...}]}] alongside entities:[] for unique connectors. The host expands each template count times by index*step and assigns identities; do not hand-enumerate hundreds of repeated entities. Expanded groups cannot be referenced by explicit wires; ordinary poles auto-connect. This is declarative data, not JavaScript. A yellow belt carries 15 items/s total, 7.5 per lane; inserters on the same side all load one lane. Red belts carry 30 total and blue express belts 45 total. Use allowed faster belts for input trunks, output trunks and row lanes whenever yellow capacity would equal or fall below the required flow. Size every bottleneck above the target, including the very first belt after each source and the last belt before the sink. Plan both lanes and enough machines and inserters, with headroom above the requested rate.';
