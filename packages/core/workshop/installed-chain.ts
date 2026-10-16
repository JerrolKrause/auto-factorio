import type { ProductionAvailability, ProductionCatalog } from '@autofactorio/contracts';
import type { CapabilityProfile } from './profiles.js';
import { digest } from '../production/graph.js';

/** Read-only preset facts returned by the installed game, never a caller permission list. */
export interface InstalledChainPreset {
  schema: 1; gameVersion: string; mods: Record<string, string>;
  profileId: string; profileRevision: number; surface: 'nauvis';
  technologies: string[]; recipes: string[]; allowedEquipment: string[];
}
export interface InstalledChainContext {
  profile: CapabilityProfile;
  snapshot: { catalog: ProductionCatalog; availability: ProductionAvailability; availabilityRevision: string };
}

export function installedChainContext(preset: InstalledChainPreset, snapshot: InstalledChainContext['snapshot']): InstalledChainContext {
  const names = (values: string[], label: string) => {
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !/^[\w.-]{1,100}$/.test(value)) || new Set(values).size !== values.length) throw new Error(`Invalid installed chain ${label}`);
    return [...values].sort();
  };
  if (preset.schema !== 1 || preset.surface !== 'nauvis' || !['starter-assembly', 'advanced-assembly', 'production-chain'].includes(preset.profileId) || !Number.isSafeInteger(preset.profileRevision) || preset.profileRevision < 1) throw new Error('Invalid installed chain preset');
  if (preset.gameVersion !== snapshot.catalog.mods.base || digest(preset.mods) !== digest(snapshot.catalog.mods)) throw new Error('Installed chain game/mod facts changed');
  const technologies = names(preset.technologies, 'technologies'), recipes = names(preset.recipes, 'recipes'), allowedEquipment = names(preset.allowedEquipment, 'equipment');
  if (recipes.some(name => !snapshot.catalog.recipes.some(recipe => recipe.name === name))) throw new Error('Installed chain recipe facts missing');
  if (allowedEquipment.some(name => !snapshot.catalog.products.some(product => product.kind === 'item' && product.name === name))) throw new Error('Installed chain equipment facts missing');
  // Workshop forces start from this explicit preset, independent of player research
  // and productivity. Preset unlocks are exported without creating a force/world.
  const permitted = new Set(recipes);
  const availability: ProductionAvailability = { tick: snapshot.availability.tick, force: `workshop-profile.${preset.profileId}`, researched: technologies, surfaceProperties: { ...snapshot.availability.surfaceProperties },
    recipes: Object.fromEntries(snapshot.catalog.recipes.map(recipe => [recipe.name, { enabled: permitted.has(recipe.name), productivity: 0 }])) };
  const availabilityRevision = digest({ ...availability, tick: 0 });
  const fingerprint = digest({ schema: 1, catalog: snapshot.catalog.fingerprint, profileId: preset.profileId, revision: preset.profileRevision, technologies, recipes, allowedEquipment, surface: preset.surface, surfaceProperties: availability.surfaceProperties });
  const profile: CapabilityProfile = { schema: 1, id: preset.profileId, revision: preset.profileRevision, fingerprint, source: 'preset', technologies, researchBonuses: {}, recipes, allowedEquipment, locallyManufacturable: [], modules: [], beacons: [], quality: 'normal', surface: preset.surface, surfaceProperties: { ...availability.surfaceProperties } };
  return { profile, snapshot: { catalog: structuredClone(snapshot.catalog), availability, availabilityRevision } };
}
