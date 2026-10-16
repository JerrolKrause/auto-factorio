local C=require('common')
local M={}
local catalogs=nil
local catalog_identity=nil
local function names(t) local out={};for n in pairs(t or {}) do out[#out+1]=n end;table.sort(out);return out end
local function array(t) local out={};for _,v in pairs(t or {}) do out[#out+1]=v end;return out end
local function conditions(p) return array(p.surface_conditions) end
-- This checksum is a cache invalidation hint, not the authoritative fact fingerprint.
-- TypeScript hashes the complete normalized catalog with SHA-256 after every refresh.
local function identity(value)
 local s=helpers.table_to_json(value);local a,b=1,0
 for i=1,#s do a=(a+s:byte(i))%65521;b=(b+a)%65521 end
 return tostring(#s)..':'..tostring(a)..':'..tostring(b)
end
local function build()
 local out={products={},recipes={},machines={}}
 for _,kind in ipairs({'item','fluid'}) do
  for _,n in ipairs(names(prototypes[kind])) do
   local p=prototypes[kind][n];local f={id=kind..':'..n,kind=kind,name=n}
   if kind=='item' then f.fuelValue=p.fuel_value;f.fuelCategory=p.fuel_category;f.burntResult=p.burnt_result and p.burnt_result.name;f.spoilage=p.spoil_result~=nil or p.spoil_to_trigger_result~=nil
   else f.defaultTemperature=p.default_temperature;f.maximumTemperature=p.max_temperature end
   out.products[#out.products+1]=f
  end
 end
 local unlocks={}
 for _,n in ipairs(names(prototypes.technology)) do
  for _,e in pairs(prototypes.technology[n].effects or {}) do
   if e.type=='unlock-recipe' then unlocks[e.recipe]=unlocks[e.recipe] or {};table.insert(unlocks[e.recipe],n) end
  end
 end
 for _,n in ipairs(names(prototypes.recipe)) do
  local p=prototypes.recipe[n]
  out.recipes[#out.recipes+1]={id='recipe:'..n,name=n,category=p.category,seconds=p.energy,ingredients=array(p.ingredients),products=array(p.products),unlocks=unlocks[n] or {},surfaceConditions=conditions(p)}
 end
 for _,n in ipairs(names(prototypes.entity)) do
  local p=prototypes.entity[n]
  if p.type=='assembling-machine' or p.type=='furnace' then
   local boxes={};for _,b in pairs(p.fluidbox_prototypes) do
    boxes[#boxes+1]={index=b.index,productionType=b.production_type,filter=b.filter and b.filter.name,minimumTemperature=b.minimum_temperature,maximumTemperature=b.maximum_temperature,volume=b.volume,connections=array(b.pipe_connections)}
   end
   local electric=p.electric_energy_source_prototype;local burner=p.burner_prototype
   local energy={kind=electric and 'electric' or burner and 'burner' or 'unsupported',maxJoulesPerTick=p.get_max_energy_usage('normal')}
   if electric then energy.drainJoulesPerTick=electric.drain end
   if burner then energy.effectivity=burner.effectivity;energy.fuelCategories=names(burner.fuel_categories) end
   local items={};for _,i in pairs(p.items_to_place_this or {}) do items[#items+1]=i.name end;table.sort(items)
   out.machines[#out.machines+1]={id='machine:'..n,name=n,type=p.type,categories=names(p.crafting_categories),speed=p.get_crafting_speed('normal'),ingredientLimit=p.ingredient_count,collisionBox={p.collision_box.left_top,p.collision_box.right_bottom},fluidBoxes=boxes,placementItems=items,energy=energy,baseEffects=p.effect_receiver and p.effect_receiver.base_effect or {},surfaceConditions=conditions(p)}
  end
 end
 return out
end
function M.read(r)
 C.keys(r,{'op','section','offset','limit'});C.check(r.section=='products' or r.section=='recipes' or r.section=='machines' or r.section=='availability','invalid_production_section');C.integer(r.offset,0,20000);C.integer(r.limit,1,50)
 if not catalogs then catalogs=build();catalog_identity=identity(catalogs) end
 local list=catalogs[r.section];local items={}
 if r.section=='availability' then
  list={};for _,n in ipairs(names(game.forces.player.recipes)) do local p=game.forces.player.recipes[n];list[#list+1]={name=n,enabled=p.enabled,productivity=p.productivity_bonus} end
 end
 for i=r.offset+1,math.min(#list,r.offset+r.limit) do items[#items+1]=list[i] end
 local researched={};local properties={}
 if r.section=='availability' then
  for _,n in ipairs(names(game.forces.player.technologies)) do if game.forces.player.technologies[n].researched then researched[#researched+1]=n end end
  for _,n in ipairs(names(prototypes.surface_property)) do properties[n]=game.surfaces.nauvis.get_property(n) end
 end
 return {ok=true,schema=1,mods=script.active_mods,contentIdentity=catalog_identity,availabilityIdentity=r.section=='availability' and identity({recipes=list,researched=researched,surfaceProperties=properties}) or nil,tick=game.tick,force='player',section=r.section,items=items,total=#list,next=r.offset+#items<#list and r.offset+#items or nil,researched=researched,surfaceProperties=properties}
end
return M
