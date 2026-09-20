import { createHash } from 'node:crypto';
import type { ProductIdentity } from '@autofactorio/contracts';

export interface InstalledTechnology { id: string; prerequisites: string[]; effects: { type: string; recipe?: string; modifier?: number }[] }
export interface InstalledRecipe { id: string; category: string; enabled: boolean; ingredients: InstalledProduct[]; products: InstalledProduct[]; stochastic?: boolean; spoilage?: boolean }
export interface InstalledProduct { type: 'item' | 'fluid'; name: string; amount: number; temperature?: number; probability?: number }
export interface InstalledEntity { id: string; type: string; craftingCategories: string[]; moduleSlots: number; surfaceConditions: string[]; settings: string[] }
export interface InstalledData { gameVersion: string; mods: Record<string,string>; technologies: InstalledTechnology[]; recipes: InstalledRecipe[]; entities: InstalledEntity[]; items: string[]; modules: string[]; surfaces: Record<string,{ properties: Record<string,number>; conditions: string[] }> }
export interface CapabilityProfile {
  schema: 1; id: string; revision: number; fingerprint: string; source: 'preset' | 'custom' | 'current-run';
  technologies: string[]; researchBonuses: Record<string,number>; recipes: string[]; allowedEquipment: string[];
  locallyManufacturable: string[]; modules: string[]; beacons: string[]; quality: 'normal'; surface: string;
  surfaceProperties?: Record<string,number>;
}
export interface ProfileRequest extends Omit<CapabilityProfile,'schema'|'fingerprint'|'technologies'|'recipes'> { technologies: string[]; recipes?: string[] }

const unique = (values: string[]) => [...new Set(values)].sort();
export function installedFingerprint(data: InstalledData): string {
  const stable = { ...data, mods: Object.fromEntries(Object.entries(data.mods).sort()), technologies: [...data.technologies].sort((a,b)=>a.id.localeCompare(b.id)), recipes: [...data.recipes].sort((a,b)=>a.id.localeCompare(b.id)), entities: [...data.entities].sort((a,b)=>a.id.localeCompare(b.id)), items: unique(data.items), modules: unique(data.modules), surfaces: Object.fromEntries(Object.entries(data.surfaces).sort()) };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}
function techClosure(data: InstalledData, requested: string[]): string[] {
  const byId = new Map(data.technologies.map(t => [t.id,t])); const visiting = new Set<string>(); const result = new Set<string>();
  const visit = (id: string) => { if (result.has(id)) return; if (visiting.has(id)) throw new Error(`Technology prerequisite cycle: ${id}`); const tech = byId.get(id); if (!tech) throw new Error(`Unknown technology: ${id}`); visiting.add(id); for (const prerequisite of tech.prerequisites) visit(prerequisite); visiting.delete(id); result.add(id); };
  requested.forEach(visit); return [...result].sort();
}
function unlockedRecipes(data: InstalledData, technologies: string[]): string[] {
  const result = new Set(data.recipes.filter(r => r.enabled).map(r => r.id));
  for (const tech of data.technologies.filter(t => technologies.includes(t.id))) for (const effect of tech.effects) if (effect.type === 'unlock-recipe' && effect.recipe) result.add(effect.recipe);
  return [...result].sort();
}
export function resolveProfile(data: InstalledData, request: ProfileRequest, expectedFingerprint = installedFingerprint(data)): CapabilityProfile {
  const fingerprint = installedFingerprint(data); if (fingerprint !== expectedFingerprint) throw new Error('Installed game/mod fingerprint changed');
  if (request.quality !== 'normal') throw new Error('Only normal quality is supported');
  if (!data.surfaces[request.surface]) throw new Error(`Unknown surface: ${request.surface}`);
  const technologies = techClosure(data, request.technologies); const availableRecipes = unlockedRecipes(data, technologies);
  const recipes = unique(request.recipes ?? availableRecipes); for (const recipe of recipes) if (!availableRecipes.includes(recipe)) throw new Error(`Recipe is not unlocked: ${recipe}`);
  const entityIds = new Set(data.entities.map(e=>e.id)); const itemIds = new Set(data.items);
  for (const equipment of request.allowedEquipment) if (!entityIds.has(equipment) && !itemIds.has(equipment)) throw new Error(`Unknown allowed equipment: ${equipment}`);
  for (const item of request.locallyManufacturable) if (!recipes.some(id => data.recipes.find(r=>r.id===id)?.products.some(p=>p.type==='item'&&p.name===item))) throw new Error(`Equipment is not locally manufacturable: ${item}`);
  for (const module of request.modules) if (!data.modules.includes(module)) throw new Error(`Unknown module: ${module}`);
  for (const beacon of request.beacons) if (!entityIds.has(beacon)) throw new Error(`Unknown beacon: ${beacon}`);
  return { schema:1,id:request.id,revision:request.revision,fingerprint,source:request.source,technologies,researchBonuses:{...request.researchBonuses},recipes,allowedEquipment:unique(request.allowedEquipment),locallyManufacturable:unique(request.locallyManufacturable),modules:unique(request.modules),beacons:unique(request.beacons),quality:'normal',surface:request.surface,surfaceProperties:{...data.surfaces[request.surface]!.properties} };
}
export function presetRequest(id: 'starter-assembly'|'advanced-assembly'|'electromagnetic-production', data: InstalledData): ProfileRequest {
  const knownTechs = new Set(data.technologies.map(t=>t.id)); const choose = (...ids:string[]) => ids.filter(id=>knownTechs.has(id));
  const base: ProfileRequest = { id, revision:1, source:'preset', technologies:[], researchBonuses:{}, allowedEquipment:['assembling-machine-1','transport-belt','underground-belt','splitter','inserter','wooden-chest','small-electric-pole'].filter(v=>data.entities.some(e=>e.id===v)||data.items.includes(v)), locallyManufacturable:[], modules:[], beacons:[], quality:'normal', surface:'nauvis' };
  if (id === 'starter-assembly') return { ...base, technologies: choose('automation','logistics') };
  if (id === 'advanced-assembly') return { ...base, technologies: choose('automation-2','logistics-2','modules','speed-module'), allowedEquipment: unique([...base.allowedEquipment,'assembling-machine-2','fast-transport-belt','fast-underground-belt','fast-splitter','fast-inserter','beacon'].filter(v=>data.entities.some(e=>e.id===v)||data.items.includes(v))), modules: data.modules.filter(v=>v==='speed-module'), beacons: data.entities.some(e=>e.id==='beacon')?['beacon']:[] };
  return { ...base, technologies: choose('electromagnetic-plant','electromagnetic-science-pack','modules'), allowedEquipment: unique([...base.allowedEquipment,'electromagnetic-plant','beacon'].filter(v=>data.entities.some(e=>e.id===v)||data.items.includes(v))), modules: data.modules.filter(v=>/module/.test(v)), beacons: data.entities.some(e=>e.id==='beacon')?['beacon']:[] };
}
export function currentRunRequest(id: string, revision: number, state: { technologies: string[]; researchBonuses: Record<string,number>; surface: string; allowedEquipment: string[] }): ProfileRequest {
  return { id, revision, source:'current-run', technologies:[...state.technologies], researchBonuses:{...state.researchBonuses}, allowedEquipment:[...state.allowedEquipment], locallyManufacturable:[], modules:[], beacons:[], quality:'normal', surface:state.surface };
}

export type CompatibilityResult = { supported: true; products: ProductIdentity[] } | { supported: false; code: string; detail: string };
const supportedEntities = new Set(['assembling-machine','furnace','chemical-plant','oil-refinery','electromagnetic-plant','foundry','transport-belt','underground-belt','splitter','inserter','container','pipe','pipe-to-ground','pump','electric-pole','lamp','beacon']);
const supportedSettings = new Set(['recipe','direction','filter','modules','connections','control_behavior_disabled','bar']);
export function checkWorkshopCompatibility(input: { entity: InstalledEntity; recipe?: InstalledRecipe; quality: string; surface: string; settings: string[]; designKind?: string }, profile: CapabilityProfile, data: InstalledData): CompatibilityResult {
  if (input.quality !== 'normal') return { supported:false,code:'unsupported_quality',detail:'Only normal quality is supported' };
  if (['train','platform','mining','power-generation','circuit-program'].includes(input.designKind ?? '')) return { supported:false,code:`unsupported_${input.designKind}`,detail:`${input.designKind} designs are outside workshop scope` };
  if (!supportedEntities.has(input.entity.type)) return { supported:false,code:'unsupported_entity',detail:`Entity type ${input.entity.type} is unsupported` };
  if (!profile.allowedEquipment.includes(input.entity.id)) return { supported:false,code:'profile_denied',detail:`${input.entity.id} is not allowed by the selected profile` };
  if (!data.surfaces[input.surface] || input.entity.surfaceConditions.some(c=>!data.surfaces[input.surface]!.conditions.includes(c))) return { supported:false,code:'surface_illegal',detail:'Entity is illegal on the selected surface' };
  const unsupported = input.settings.find(s=>!supportedSettings.has(s)); if (unsupported) return { supported:false,code:'unsupported_setting',detail:`Setting ${unsupported} is unsupported` };
  if (!input.recipe) return { supported:true,products:[] };
  if (!profile.recipes.includes(input.recipe.id) || !input.entity.craftingCategories.includes(input.recipe.category)) return { supported:false,code:'recipe_incompatible',detail:'Recipe is unavailable to this entity/profile' };
  if (input.recipe.stochastic || input.recipe.products.some(p=>p.probability!==undefined&&p.probability!==1)) return { supported:false,code:'unsupported_stochastic',detail:'Stochastic recipes are unsupported' };
  if (input.recipe.spoilage) return { supported:false,code:'unsupported_spoilage',detail:'Spoilage behavior is unsupported' };
  const products = input.recipe.products.map(p=>({kind:p.type,name:p.name,quality:'normal' as const,surface:input.surface,...(p.temperature===undefined?{}:{temperature:p.temperature})}));
  return { supported:true,products };
}
