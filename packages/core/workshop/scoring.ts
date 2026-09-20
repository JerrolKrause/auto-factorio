import { createHash } from 'node:crypto';
import type { BlueprintDocument, Rational, WorkshopAssignment, WorkshopEvaluationReport, WorkshopScore } from '@autofactorio/contracts';
import { billOfMaterials, blueprintContentHash, normalizeBlueprint } from './blueprint.js';
import type { InstalledRecipe } from './profiles.js';

export interface AcquisitionRoute { item:string;recipe:string|null;amount:number;ingredients:{name:string;amount:number}[];productAmount:number }
export interface ExpansionProbe { scale:1|2|3|4; passed:boolean; removed:number; replaced:number; connections:number; evidence:string[] }
export interface ScoreInput { sessionId:string;iteration:number;assignmentRevision:number;bundleHash:string;document:BlueprintDocument;evaluation:WorkshopEvaluationReport;rubricVersion:string;routes:AcquisitionRoute[];rawResources:string[];expansion:ExpansionProbe[];energy:number|null;inputs:Record<string,number>|null;outputs:Record<string,number>|null;interaction:{rejectedCalls:number;rebuilds:number;unknownOutcomes:number;toolCalls:number;reportedTokens:number|null;evidence:string[]} }
const ratio=(numerator:number,denominator:number)=>denominator===0?null:numerator/denominator;
export function rawCostVector(items:Record<string,number>,routes:AcquisitionRoute[],rawResources:string[]):{vector:Record<string,number>;unknown:string[];recipes:string[]}{
  const byItem=new Map(routes.map(route=>[route.item,route])),raw=new Set(rawResources),vector:Record<string,number>={},unknown=new Set<string>(),recipes=new Set<string>();const visiting=new Set<string>();
  const expand=(name:string,count:number)=>{if(raw.has(name)){vector[name]=(vector[name]??0)+count;return;}const route=byItem.get(name);if(!route||!route.recipe||route.productAmount<=0){unknown.add(name);return;}if(visiting.has(name))throw new Error(`Acquisition recipe cycle: ${name}`);visiting.add(name);recipes.add(route.recipe);const crafts=count/route.productAmount;for(const ingredient of route.ingredients)expand(ingredient.name,ingredient.amount*crafts);visiting.delete(name);};for(const[name,count]of Object.entries(items))expand(name,count);return{vector:Object.fromEntries(Object.entries(vector).sort(([a],[b])=>a.localeCompare(b))),unknown:[...unknown].sort(),recipes:[...recipes].sort()};
}
export function scoreWorkshop(input:ScoreInput):WorkshopScore{
  const document=normalizeBlueprint(input.document),bom=billOfMaterials(document),cost=rawCostVector(bom,input.routes,input.rawResources);const xs=document.entities.map(e=>e.position.x),ys=document.entities.map(e=>e.position.y),width=Math.max(...xs)-Math.min(...xs)+1,height=Math.max(...ys)-Math.min(...ys)+1;const footprint=width*height;const validScales=input.expansion.filter(p=>p.passed).map(p=>p.scale);const maximum=validScales.length?Math.max(...validScales):1;const eligible=input.evaluation.valid&&input.evaluation.passed;const evidence=[...new Set([...input.evaluation.evidence,...input.expansion.flatMap(p=>p.evidence),...input.interaction.evidence])];
  return{schema:1,candidate:{sessionId:input.sessionId,iteration:input.iteration,artifactHash:blueprintContentHash(document),assignmentRevision:input.assignmentRevision,bundleHash:input.bundleHash,evidence},rubricVersion:input.rubricVersion,eligible,dimensions:{
    throughput:{value:eligible?Math.min(...input.evaluation.ports.flatMap(p=>p.windows.map(w=>Number(w.deliveryLower.numerator)/Number(w.deliveryLower.denominator)))):null,unit:'conservative-units-per-window',evidence:input.evaluation.evidence,judgment:eligible?'measured':'unknown'},
    expandability:{value:maximum,unit:'tested-scale',evidence:input.expansion.flatMap(p=>p.evidence),judgment:input.expansion.length?'measured':'unknown'},
    space:{value:footprint,unit:'bounding-tiles',evidence:[],judgment:'derived'},
    clearance:{value:(width+2)*(height+2)-footprint,unit:'reserved-tiles',evidence:[],judgment:'derived'},
    resourceEfficiency:{value:input.inputs&&input.outputs?ratio(Object.values(input.outputs).reduce((a,b)=>a+b,0),Object.values(input.inputs).reduce((a,b)=>a+b,0)):null,unit:'useful-output-per-input',evidence:input.evaluation.evidence,judgment:input.inputs&&input.outputs?'measured':'unknown'},
    connectability:{value:document.ports.length,unit:'declared-ports',evidence:input.expansion.flatMap(p=>p.evidence),judgment:document.ports.length?'derived':'unknown'},
    constructionCost:{value:cost.unknown.length?null:Object.values(cost.vector).reduce((a,b)=>a+b,0),unit:cost.unknown.length?'unknown-raw-vector':'raw-resource-units',evidence:cost.recipes,judgment:cost.unknown.length?'unknown':'derived'},
    energy:{value:input.energy,unit:'joules-per-useful-output',evidence:input.evaluation.evidence,judgment:input.energy===null?'unknown':'measured'},
    aesthetics:{value:null,unit:'optional-subjective',evidence:[],judgment:'subjective'},
    interactionQuality:{value:input.interaction.rejectedCalls+input.interaction.rebuilds+input.interaction.unknownOutcomes,unit:'recorded-friction-events',evidence:input.interaction.evidence,judgment:'measured'},
  },feedback:eligible?`Verified target; tested expansion through ${maximum}x. Raw cost ${cost.unknown.length?`unknown for ${cost.unknown.join(', ')}`:JSON.stringify(cost.vector)}.`:`Candidate is ineligible: ${input.evaluation.reasons.join(', ')}.`,interactionFeedback:`${input.interaction.rejectedCalls} rejected calls, ${input.interaction.rebuilds} rebuilds, ${input.interaction.unknownOutcomes} unknown outcomes, ${input.interaction.toolCalls} tool calls; reported tokens ${input.interaction.reportedTokens??'unknown'}.`,invalidReasons:eligible?[]:[...input.evaluation.reasons]};
}
export function paretoDistinct(a:WorkshopScore,b:WorkshopScore,dimensions:string[]):boolean{
  let aBetter=false,bBetter=false;for(const name of dimensions){const av=a.dimensions[name]?.value,bv=b.dimensions[name]?.value;if(av===null||av===undefined||bv===null||bv===undefined)continue;if(av<bv)aBetter=true;else if(bv<av)bBetter=true;}return aBetter&&bBetter;
}
export const rationalNumber=(value:Rational)=>Number(value.numerator)/Number(value.denominator);
export function workshopRubricHash(rubric:WorkshopAssignment['rubric']):string{const ordered=(values:Record<string,unknown>)=>Object.fromEntries(Object.entries(values).sort(([a],[b])=>a.localeCompare(b)));return createHash('sha256').update(JSON.stringify({version:rubric.version,weights:ordered(rubric.weights),materiality:ordered(rubric.materiality),directions:ordered(rubric.directions)})).digest('hex');}
export function compareWorkshopScores(a:WorkshopScore|null,b:WorkshopScore|null,rubric:WorkshopAssignment['rubric']):number{
  if(a?.eligible!==true)return b?.eligible===true?-1:0;if(b?.eligible!==true)return 1;
  if(a.rubricVersion!==rubric.version||b.rubricVersion!==rubric.version)throw new Error('Score rubric version mismatch');
  let weighted=0,knownDelta=0;
  for(const [name,weightValue] of Object.entries(rubric.weights)){
    const av=a.dimensions[name]?.value,bv=b.dimensions[name]?.value;
    if(av===null||av===undefined){if(bv!==null&&bv!==undefined)knownDelta--;continue;}
    if(bv===null||bv===undefined){knownDelta++;continue;}
    const materiality=rationalNumber(rubric.materiality[name]!);let delta=av-bv;
    if(Math.abs(delta)<=materiality)continue;
    if(rubric.directions[name]==='minimize')delta=-delta;
    weighted+=delta*rationalNumber(weightValue);
  }
  if(weighted!==0)return weighted>0?1:-1;
  return knownDelta===0?0:knownDelta>0?1:-1;
}
export const installedRoutes=(recipes:InstalledRecipe[]):AcquisitionRoute[]=>recipes.map(recipe=>({item:recipe.products[0]?.name??recipe.id,recipe:recipe.id,amount:1,ingredients:recipe.ingredients.filter(i=>i.type==='item').map(i=>({name:i.name,amount:i.amount})),productAmount:recipe.products[0]?.amount??1}));
