-- Ordinary gameplay observations only. This sampler is intentionally separate
-- from evaluator admission, traces and fault/reference state.
local C=require('common')
local M={}
local function state()
 storage.af.operational=storage.af.operational or {scopes={}}
 return storage.af.operational
end
local function item_key(name,quality) return name..'/'..(quality or 'normal') end
local function reading(kind,name,quality,surface,total,method,coverage,reason,productKind,errorBound)
 return {kind=kind,name=name,quality=quality or 'normal',surface=surface,total=total,method=method,coverage=coverage or 'complete',reason=reason,productKind=productKind or 'item',errorBound=errorBound or 0,evidence={'ordinary-game-state'}}
end
local function membership(entities)
 local ids={};for _,e in pairs(entities) do local recipe=(e.type=='assembling-machine' or e.type=='furnace') and e.get_recipe() or nil;ids[#ids+1]=(e.unit_number or 0)..':'..e.name..':'..e.position.x..':'..e.position.y..':'..(recipe and recipe.name or '') end;table.sort(ids)
 -- Keep the identifier bounded at the documented 5,000-entity limit. This is a
 -- change detector, not an authorization or cryptographic identity.
 local hash1,hash2=5381,52711;for _,id in ipairs(ids) do for i=1,#id do local byte=string.byte(id,i);hash1=(hash1*131+byte)%2147483647;hash2=(hash2*137+byte)%2147483629 end;hash1=(hash1*131+46)%2147483647;hash2=(hash2*137+46)%2147483629 end
 return 'm'..#ids..'-'..hash1..'-'..hash2
end
local function add_inventory(stock,inv)
 if not inv then return end
 for _,v in pairs(C.inventory(inv)) do local k=item_key(v.name,v.quality);stock[k]=(stock[k] or 0)+v.count end
end
local function snapshot(scope)
 local surface=game.surfaces[scope.surface];C.check(surface,'operational_surface_missing')
 local entities=surface.find_entities_filtered{area=scope.area,force='player'};C.check(#entities<=scope.entityLimit,'operational_entity_limit')
 if scope.recipe or scope.machine then local selected={};for _,e in pairs(entities) do if (e.type=='assembling-machine' or e.type=='furnace') and (not scope.machine or e.name==scope.machine) then local r=e.get_recipe();if r and (not scope.recipe or r.name==scope.recipe) then selected[#selected+1]=e end end end;entities=selected end
 local production={};local consumption={};local stock={};local fluidStock={};local unsupported={};local errors={};local symptoms={};local symptomCount=0
 for _,e in pairs(entities) do
  if e.type=='assembling-machine' or e.type=='furnace' then
   local recipe,quality=e.get_recipe()
   symptomCount=symptomCount+1
   if #symptoms<16 then symptoms[#symptoms+1]={unit=e.unit_number or 0,name=e.name,position=e.position,tick=game.tick,status=tostring(e.status),recipe=recipe and recipe.name or nil,power=e.electric_network_id and e.energy or nil,coverage='complete',evidence={'ordinary-game-state'}} end
   if recipe then
    -- Lifetime craft counters are local gross flow, not force totals or stock deltas.
    -- Bonuses and non-normal recipes invalidate both inputs and outputs.
    local modules=e.get_module_inventory()
    local bad=(e.quality.name~='normal' or quality and quality.name~='normal' or e.productivity_bonus~=0 or e.speed_bonus~=0 or e.consumption_bonus~=0 or modules and not modules.is_empty()) and 'unsupported_bonus_or_quality' or nil
    local function key(p) return p.type..':'..item_key(p.name,'normal') end
    local function add(map,p,kind)
     local k=key(p)
     if bad or not p.amount or p.probability and p.probability~=1 or (p.extra_count_fraction or 0)~=0 or (p.percent_spoiled or 0)~=0 or p.amount_min or p.amount_max then unsupported[k]=bad or 'unsupported_recipe_amount'
     else
      map[k]=(map[k] or 0)+e.products_finished*p.amount
      -- Consumption may lead completed crafts by one in-flight craft per machine.
      -- The fluid rounding allowance is calibrated by the installed-game probe.
      errors[kind..'/'..k]=(errors[kind..'/'..k] or 0)+(kind=='consumption' and p.amount or 0)+(p.type=='fluid' and 0.001 or 0)
     end
    end
    for _,p in pairs(recipe.products) do add(production,p,'production') end
    for _,p in pairs(recipe.ingredients) do add(consumption,p,'consumption') end
   end
   if e.type=='furnace' then
    add_inventory(stock,e.get_inventory(defines.inventory.furnace_source));add_inventory(stock,e.get_inventory(defines.inventory.furnace_result))
   else add_inventory(stock,e.get_inventory(defines.inventory.assembling_machine_input));add_inventory(stock,e.get_inventory(defines.inventory.assembling_machine_output)) end
  elseif e.type=='container' then add_inventory(stock,e.get_inventory(defines.inventory.chest))
  elseif e.type=='transport-belt' or e.type=='underground-belt' or e.type=='splitter' then for i=1,e.get_max_transport_line_index() do for _,v in pairs(e.get_transport_line(i).get_contents()) do local k=item_key(v.name,v.quality);stock[k]=(stock[k] or 0)+v.count end end
  elseif e.type=='inserter' and e.held_stack.valid_for_read then local v=e.held_stack;local k=item_key(v.name,v.quality.name);stock[k]=(stock[k] or 0)+v.count end
  if e.fluidbox then for i=1,#e.fluidbox do local f=e.fluidbox[i];if f then local k=item_key(f.name,'normal');fluidStock[k]=(fluidStock[k] or 0)+f.amount end end end
 end
 local readings={}
 local function append(map,kind,method,productKind)
  for key,total in pairs(map) do
   local identity=key;local pk=productKind
   if not pk then pk,identity=string.match(key,'^([^:]+):(.+)$') end
   local name,quality=string.match(identity,'^(.+)/([^/]+)$')
   local reason=unsupported[key]
   local value=total;if reason then value=nil end
   readings[#readings+1]=reading(kind,name,quality,scope.surface,value,method,reason and 'unknown' or 'complete',reason,pk,errors[kind..'/'..key] or 0)
  end
 end
 append(production,'production','local-completed-crafts-v2');append(consumption,'consumption','local-completed-crafts-v2');append(stock,'stock','scoped-inventory-v1','item');append(fluidStock,'stock','scoped-fluidbox-v1','fluid')
 for key,reason in pairs(unsupported) do
  local pk,identity=string.match(key,'^([^:]+):(.+)$');local name,quality=string.match(identity,'^(.+)/([^/]+)$')
  for _,kind in ipairs({'production','consumption'}) do
   local map=kind=='production' and production or consumption
   if not map[key] then readings[#readings+1]=reading(kind,name,quality,scope.surface,nil,'unsupported-recipe-v2','unknown',reason,pk) end
  end
 end
 local scenario=storage.af.scenario
 if scenario then
  local elapsed=math.max(0,game.tick-scenario.origin)
  local function contains(e) return e and e.valid and e.surface.name==scope.surface and e.position.x>=scope.area[1].x and e.position.y>=scope.area[1].y and e.position.x<=scope.area[2].x and e.position.y<=scope.area[2].y end
  for item,total in pairs(scenario.injected) do if contains(scenario.terminals[item]) then readings[#readings+1]=reading('boundary-delivery',item,'normal',scope.surface,total,'public-terminal-insert-v1');readings[#readings+1]=reading('configured-supply',item,'normal',scope.surface,scenario.manifest.rates[item]*elapsed/3600,'scenario-terminal-schedule-v1') end end
  if contains(scenario.collector) then readings[#readings+1]=reading('boundary-delivery','automation-science-pack','normal',scope.surface,scenario.collected,'public-collector-drain-v1') end
 end
 table.sort(readings,function(a,b)return (a.kind..a.surface..a.productKind..a.name..a.quality)<(b.kind..b.surface..b.productKind..b.name..b.quality) end)
 return {schema=1,epoch=storage.af.epoch,scopeId=scope.id,scopeRevision=scope.revision,membershipHash=membership(entities),tick=game.tick,readings=readings,symptoms=symptoms,symptomsOmitted=math.max(0,symptomCount-#symptoms)}
end
local function take(entry)
 local sample=snapshot(entry.scope);local previous=entry.samples[#entry.samples]
 if entry.error then for _,r in pairs(sample.readings) do r.coverage='unknown';r.reason=entry.error end;entry.error=nil end
 if previous then
  local totals={};for _,r in pairs(previous.readings) do totals[r.kind..'/'..(r.productKind or 'item')..'/'..r.name..'/'..r.quality]=r.total end
  for _,r in pairs(sample.readings) do local old=totals[r.kind..'/'..(r.productKind or 'item')..'/'..r.name..'/'..r.quality];if old and r.total and r.kind~='stock' and r.total<old then r.coverage='unknown';r.reason='counter_reset' end end
 end
 entry.samples[#entry.samples+1]=sample;while #entry.samples>entry.historySamples do table.remove(entry.samples,1) end
 entry.next=game.tick+entry.sampleTicks
end
function M.tick()
 local operational=state();for _,entry in pairs(operational.scopes) do
  if game.tick==entry.next then local ok,err=pcall(function()take(entry)end);if not ok then entry.error=tostring(err);entry.next=game.tick+entry.sampleTicks end
  elseif game.tick>entry.next then entry.error='missing_sample_tick';entry.next=game.tick+entry.sampleTicks end
 end
end
function M.register(r)
 local s=r.scope;local operational=state();local prior=operational.scopes[s.id]
 if prior and prior.scope.revision>s.revision then error('stale_operational_scope',0) end
 if not prior then local n=0;for _ in pairs(operational.scopes) do n=n+1 end;C.check(n<32,'operational_scope_limit') end
 local entry={scope=s,sampleTicks=r.sampleTicks,historySamples=r.historySamples,samples={},next=game.tick,error=nil};operational.scopes[s.id]=entry;take(entry)
 return {ok=true,tick=game.tick,scopeId=s.id,scopeRevision=s.revision}
end
function M.read(r)
 local entry=state().scopes[r.scopeId];C.check(entry and entry.scope.revision==r.scopeRevision,'operational_scope_missing')
 local samples={};for _,sample in ipairs(entry.samples) do if sample.tick>r.afterTick then samples[#samples+1]=sample end end
 return {ok=true,tick=game.tick,samples=samples,error=entry.error,cadence=entry.sampleTicks,retention=entry.historySamples}
end
-- Operator-only calibration source. This reads engine/scenario counters directly
-- and deliberately does not reuse scope samples or derived operational readings.
function M.raw(area)
 C.check(type(area)=='table' and #area==2,'invalid_operational_raw_area');C.pos(area[1]);C.pos(area[2]);C.check(area[1].x<=area[2].x and area[1].y<=area[2].y,'reversed_operational_raw_area')
 local out={tick=game.tick,recipes={},injected={},collected=0,rates={},assemblerSpeed=0,stock={}}
 local function add(inv) if inv then for _,v in pairs(C.inventory(inv)) do local k=item_key(v.name,v.quality);out.stock[k]=(out.stock[k] or 0)+v.count end end end
 for _,e in pairs(game.surfaces.nauvis.find_entities_filtered{area=area,force='player'}) do
  if e.type=='assembling-machine' then local r=e.get_recipe();if r then local row=out.recipes[r.name] or {finished=0,machines=0};row.finished=row.finished+e.products_finished;row.machines=row.machines+1;out.recipes[r.name]=row end;add(e.get_inventory(defines.inventory.assembling_machine_input));add(e.get_inventory(defines.inventory.assembling_machine_output))
  elseif e.type=='container' then add(e.get_inventory(defines.inventory.chest))
  elseif e.type=='transport-belt' or e.type=='underground-belt' or e.type=='splitter' then for i=1,e.get_max_transport_line_index() do for _,v in pairs(e.get_transport_line(i).get_contents()) do local k=item_key(v.name,v.quality);out.stock[k]=(out.stock[k] or 0)+v.count end end
  elseif e.type=='inserter' and e.held_stack.valid_for_read then local v=e.held_stack;local k=item_key(v.name,v.quality.name);out.stock[k]=(out.stock[k] or 0)+v.count end
 end
 local scenario=storage.af.scenario;if scenario then for name,total in pairs(scenario.injected) do out.injected[name]=total end;for name,rate in pairs(scenario.manifest.rates) do out.rates[name]=rate end;out.collected=scenario.collected;out.assemblerSpeed=scenario.manifest.assemblerSpeed end
 return out
end
return M
