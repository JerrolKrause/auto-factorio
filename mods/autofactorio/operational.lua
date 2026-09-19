-- Ordinary gameplay observations only. This sampler is intentionally separate
-- from evaluator admission, traces and fault/reference state.
local C=require('common')
local M={}
local function state()
 storage.af.operational=storage.af.operational or {scopes={}}
 return storage.af.operational
end
local function item_key(name,quality) return name..'/'..(quality or 'normal') end
local function reading(kind,name,quality,surface,total,method,coverage,reason)
 return {kind=kind,name=name,quality=quality or 'normal',surface=surface,total=total,method=method,coverage=coverage or 'complete',reason=reason,evidence={'ordinary-game-state'}}
end
local function membership(entities)
 local ids={};for _,e in pairs(entities) do local recipe=e.type=='assembling-machine' and e.get_recipe() or nil;ids[#ids+1]=(e.unit_number or 0)..':'..e.name..':'..e.position.x..':'..e.position.y..':'..(recipe and recipe.name or '') end;table.sort(ids)
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
 local production={};local consumption={};local stock={};local unsupported={}
 for _,e in pairs(entities) do
  if e.type=='assembling-machine' then
   local recipe=e.get_recipe()
   if recipe then
    local finished=e.products_finished
    for _,p in pairs(recipe.products) do
     if p.type=='item' and p.amount and (not p.probability or p.probability==1) and not p.extra_count_fraction then production[item_key(p.name,'normal')]=(production[item_key(p.name,'normal')] or 0)+finished*p.amount
     else unsupported[p.name or recipe.name]='unsupported_product' end
    end
    for _,i in pairs(recipe.ingredients) do if i.type=='item' then consumption[item_key(i.name,'normal')]=(consumption[item_key(i.name,'normal')] or 0)+finished*i.amount else unsupported[i.name or recipe.name]='unsupported_ingredient' end end
   end
   add_inventory(stock,e.get_inventory(defines.inventory.assembling_machine_input));add_inventory(stock,e.get_inventory(defines.inventory.assembling_machine_output))
  elseif e.type=='container' then add_inventory(stock,e.get_inventory(defines.inventory.chest))
  elseif e.type=='transport-belt' or e.type=='underground-belt' or e.type=='splitter' then for i=1,e.get_max_transport_line_index() do for _,v in pairs(e.get_transport_line(i).get_contents()) do local k=item_key(v.name,v.quality);stock[k]=(stock[k] or 0)+v.count end end
  elseif e.type=='inserter' and e.held_stack.valid_for_read then local v=e.held_stack;local k=item_key(v.name,v.quality.name);stock[k]=(stock[k] or 0)+v.count end
 end
 local readings={};local function append(map,kind,method) for key,total in pairs(map) do local name,quality=string.match(key,'^(.+)/([^/]+)$');readings[#readings+1]=reading(kind,name,quality,scope.surface,total,method) end end
 append(production,'production','assembler-products-finished-v1');append(consumption,'consumption','recipe-supported-products-finished-v1');append(stock,'stock','scoped-inventory-v1')
 local scenario=storage.af.scenario
 if scenario then
  local elapsed=math.max(0,game.tick-scenario.origin)
  local function contains(e) return e and e.valid and e.surface.name==scope.surface and e.position.x>=scope.area[1].x and e.position.y>=scope.area[1].y and e.position.x<=scope.area[2].x and e.position.y<=scope.area[2].y end
  for item,total in pairs(scenario.injected) do if contains(scenario.terminals[item]) then readings[#readings+1]=reading('boundary-delivery',item,'normal',scope.surface,total,'public-terminal-insert-v1');readings[#readings+1]=reading('configured-supply',item,'normal',scope.surface,scenario.manifest.rates[item]*elapsed/3600,'scenario-terminal-schedule-v1') end end
  if contains(scenario.collector) then readings[#readings+1]=reading('boundary-delivery','automation-science-pack','normal',scope.surface,scenario.collected,'public-collector-drain-v1') end
 end
 for name,reason in pairs(unsupported) do readings[#readings+1]=reading('production',name,'normal',scope.surface,nil,'unsupported-recipe-v1','unknown',reason) end
 table.sort(readings,function(a,b)return (a.kind..a.surface..a.name..a.quality)<(b.kind..b.surface..b.name..b.quality) end)
 return {schema=1,epoch=storage.af.epoch,scopeId=scope.id,scopeRevision=scope.revision,membershipHash=membership(entities),tick=game.tick,readings=readings}
end
local function take(entry)
 local sample=snapshot(entry.scope);local previous=entry.samples[#entry.samples]
 if entry.error then for _,r in pairs(sample.readings) do r.coverage='unknown';r.reason=entry.error end;entry.error=nil end
 if previous then
  local totals={};for _,r in pairs(previous.readings) do totals[r.kind..'/'..r.name..'/'..r.quality]=r.total end
  for _,r in pairs(sample.readings) do local old=totals[r.kind..'/'..r.name..'/'..r.quality];if old and r.total and r.kind~='stock' and r.total<old then r.coverage='unknown';r.reason='counter_reset' end end
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
