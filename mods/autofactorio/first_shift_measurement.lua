-- Private engine telemetry. Connectivity selects candidate scopes, while transfer
-- events and reconciled inventories prove flow through each production stage.
local C=require('common')
local V=require('verification')
local M={}
local belt={['transport-belt']=true,['underground-belt']=true,splitter=true}
local function zero() return {containers=0,belts=0,hands=0,inProcess=0,segments={}} end
local function count(inv,item) return inv and inv.get_item_count{name=item,quality='normal'} or 0 end
local function segment(stock,e,n,segments) if n>0 then local id=segments[e.unit_number] or ('component:'..e.unit_number);stock.segments[id]=(stock.segments[id] or 0)+n end end
local function ancestors(edges,seeds)
 local seen={};local pending={};for id in pairs(seeds) do seen[id]=true;pending[#pending+1]=id end
 local i=1;while i<=#pending do local id=pending[i];i=i+1;for parent in pairs(edges[id] or {}) do if not seen[parent] then seen[parent]=true;pending[#pending+1]=parent end end end
 return seen
end
local function observed_ancestors(g,item,seeds)
 local seen={};local pending={};for id in pairs(seeds) do seen[id]=true;pending[#pending+1]=id end
 local observed=g.flowReverse[item] or {};local i=1
 while i<=#pending do local id=pending[i];i=i+1
  for _,edges in pairs({g.flowBase[id] or {},observed[id] or {}}) do for parent in pairs(edges) do if not seen[parent] then seen[parent]=true;pending[#pending+1]=parent end end end
 end
 return seen
end
local function graph(s)
 local entities={};local reverse={};local flowBase={};local stockLinks={}
 for _,e in pairs(game.surfaces.nauvis.find_entities_filtered{area=s.manifest.area,force='player'}) do if e.unit_number then entities[e.unit_number]=e end end
 local function add_edge(edges,a,b)
  if a and b and a.valid and b.valid and entities[a.unit_number] and entities[b.unit_number] then local id=b.unit_number;edges[id]=edges[id] or {};edges[id][a.unit_number]=true end
 end
 local function stock_edge(a,b)
  if a and b and a.valid and b.valid and entities[a.unit_number] and entities[b.unit_number] then
   stockLinks[a.unit_number]=stockLinks[a.unit_number] or {};stockLinks[a.unit_number][b.unit_number]=true
   stockLinks[b.unit_number]=stockLinks[b.unit_number] or {};stockLinks[b.unit_number][a.unit_number]=true
  end
 end
 local function edge(a,b,flow,stock)
  add_edge(reverse,a,b);if flow then add_edge(flowBase,a,b) end;if stock then stock_edge(a,b) end
 end
 local function installed_target(e,direct,position)
  if direct then return direct end
  -- Disabled/unpowered inserters have no dynamic target, but their installed
  -- endpoints still define topology. This keeps inactive branches visible to
  -- causal controls without crediting any transfer through them.
  for _,candidate in pairs(game.surfaces.nauvis.find_entities_filtered{position=position}) do if candidate.unit_number and candidate.unit_number~=e.unit_number then return candidate end end
 end
 for _,e in pairs(entities) do
  if belt[e.type] then
   for _,out in pairs(e.belt_neighbours.outputs) do edge(e,out,true,true) end
   if e.type=='underground-belt' and e.belt_to_ground_type=='input' then edge(e,e.neighbours,true,true) end
  elseif e.type=='inserter' then
   local pickup=installed_target(e,e.pickup_target,e.pickup_position);local drop=installed_target(e,e.drop_target,e.drop_position)
   edge(pickup,e,nil,e.active);edge(e,drop,nil,e.active)
  end
 end
 -- Freeze weak stock connectivity at admission. Normal transfers within an
 -- active route reconcile as one segment, while disabled side branches remain
 -- distinct even though installed topology still makes them measurement candidates.
 local stockSegment={}
 for seed in pairs(entities) do if not stockSegment[seed] then
  local pending={seed};local members={};local seen={[seed]=true};local minimum=seed;local i=1
  while i<=#pending do local id=pending[i];i=i+1;members[#members+1]=id;if id<minimum then minimum=id end;for nextId in pairs(stockLinks[id] or {}) do if not seen[nextId] then seen[nextId]=true;pending[#pending+1]=nextId end end end
  local key='component:'..minimum;for _,id in pairs(members) do stockSegment[id]=key end
 end end
 local collectorSeed={[s.collector.unit_number]=true};local outputIds=ancestors(reverse,collectorSeed);local science={};local scienceSeeds={}
 for id,e in pairs(entities) do if e.type=='assembling-machine' and outputIds[id] then local r=e.get_recipe();if r and r.name=='automation-science-pack' then science[id]=e;scienceSeeds[id]=true end end end
 local scienceUpIds=ancestors(reverse,scienceSeeds);for id in pairs(science) do scienceUpIds[id]=nil end
 local gears={};local gearSeeds={}
 if s.manifest.id=='02-some-assembly-required' then
  for id,e in pairs(entities) do if e.type=='assembling-machine' and scienceUpIds[id] then local r=e.get_recipe();if r and r.name=='iron-gear-wheel' then gears[id]=e;gearSeeds[id]=true end end end
 end
 local gearUpIds=ancestors(reverse,gearSeeds);for id in pairs(gears) do gearUpIds[id]=nil end
 local function select(ids) local out={};for id in pairs(ids) do out[id]=entities[id] end;return out end
 local hands={};for id,e in pairs(entities) do if e.type=='inserter' and (scienceUpIds[id] or gearUpIds[id] or outputIds[id]) then hands[id]={count=0} end end
 return {entities=entities,stockSegment=stockSegment,science=science,scienceSeeds=scienceSeeds,gears=gears,gearSeeds=gearSeeds,collectorSeed=collectorSeed,flowBase=flowBase,flowReverse={},scienceUp=select(scienceUpIds),gearUp=select(gearUpIds),output=select(outputIds),delivered={},hands=hands,samples={},sequence=0}
end
local function add_entity(stock,e,item,segments)
 C.check(e.valid,'measurement_entity_removed')
 local n=0
 if belt[e.type] then
  for i=1,e.get_max_transport_line_index() do n=n+e.get_transport_line(i).get_item_count{name=item,quality='normal'} end;stock.belts=stock.belts+n
 elseif e.type=='container' then n=count(e.get_inventory(defines.inventory.chest),item);stock.containers=stock.containers+n
 elseif e.type=='inserter' then local h=e.held_stack;if h.valid_for_read and h.name==item and h.quality.name=='normal' then n=h.count;stock.hands=stock.hands+n end
 elseif e.type=='assembling-machine' then n=count(e.get_inventory(defines.inventory.assembling_machine_input),item)+count(e.get_inventory(defines.inventory.assembling_machine_output),item);stock.containers=stock.containers+n
 end
 segment(stock,e,n,segments)
end
local function inventory(scope,machines,item,ingredient,segments)
 local up=zero();local down=zero()
 for _,e in pairs(scope) do if not machines[e.unit_number] then add_entity(up,e,item,segments) end end
 for _,e in pairs(machines) do C.check(e.valid,'measurement_machine_removed');local n=count(e.get_inventory(defines.inventory.assembling_machine_input),item);down.containers=down.containers+n;if e.is_crafting() then n=n+ingredient;down.inProcess=down.inProcess+ingredient end;segment(down,e,n,segments) end
 return up,down
end
local function hand(e) local h=e.held_stack;return h.valid_for_read and {name=h.name,quality=h.quality.name,count=h.count,source=e.pickup_target and e.pickup_target.unit_number or nil} or {count=0} end
local function machine_products(machines,item)
 local total=0;for _,e in pairs(machines) do C.check(e.valid,'measurement_machine_removed');local r=e.get_recipe();if r then for _,p in pairs(r.products) do if p.name==item then total=total+e.products_finished*p.amount end end end end;return total
end
local function science_inventory(g) local stock=zero();for _,e in pairs(g.output) do add_entity(stock,e,'automation-science-pack',g.stockSegment) end;return stock end
local function actor_inventory(p) local cursor=p.cursor_stack;return {main=C.inventory(p.get_main_inventory()),cursor=cursor.valid_for_read and {name=cursor.name,quality=cursor.quality.name,count=cursor.count} or {}} end
local function reading(source,boundary,consumer,produced,causalProduced,forward,consumed,up,down)
 return {source=source,boundary=boundary,consumer=consumer,produced=produced,causalProduced=causalProduced,forward=forward or 0,reverse=0,consumed=consumed,upstream=up,downstream=down,coverage='complete'}
end
local function sample(s,g)
 local v=storage.af.verification;local science=machine_products(g.science,'automation-science-pack');local stages={}
 local scienceRecipe=game.forces.player.recipes['automation-science-pack'];local scienceIngredients={};for _,i in pairs(scienceRecipe.ingredients) do scienceIngredients[i.name]=i.amount end
 if s.manifest.id=='02-some-assembly-required' then
  local gearRecipe=game.forces.player.recipes['iron-gear-wheel'];local iron=gearRecipe.ingredients[1].amount;local gearProduct=machine_products(g.gears,'iron-gear-wheel')
  local scienceFlow=observed_ancestors(g,'automation-science-pack',g.collectorSeed);local causalScience={};local causalScienceSeeds={};for id,e in pairs(g.science) do if scienceFlow[id] then causalScience[id]=e;causalScienceSeeds[id]=true end end
  local gearFlow=observed_ancestors(g,'iron-gear-wheel',causalScienceSeeds);local causalGears={};local causalGearSeeds={};for id,e in pairs(g.gears) do if gearFlow[id] then causalGears[id]=e;causalGearSeeds[id]=true end end
  local ironFlow=observed_ancestors(g,'iron-plate',causalGearSeeds);local copperFlow=observed_ancestors(g,'copper-plate',causalScienceSeeds)
  local ironUp,ironDown=inventory(g.gearUp,g.gears,'iron-plate',iron,g.stockSegment)
  local ironProduced=g.gearUp[s.terminals['iron-plate'].unit_number] and s.injected['iron-plate'] or 0
  stages['iron-plate']=reading('terminal-iron-plate','gear-input-iron-plate','connected-gear-machines',ironProduced,ironFlow[s.terminals['iron-plate'].unit_number] and ironProduced or 0,g.delivered['iron-plate'],gearProduct*iron,ironUp,ironDown)
  local gearUp,gearDown=inventory(g.scienceUp,g.science,'iron-gear-wheel',scienceIngredients['iron-gear-wheel'],g.stockSegment)
  stages['iron-gear-wheel']=reading('connected-gear-machines','science-input-iron-gear-wheel','collector-science-chain',gearProduct,machine_products(causalGears,'iron-gear-wheel'),g.delivered['iron-gear-wheel'],science*scienceIngredients['iron-gear-wheel'],gearUp,gearDown)
  local copperUp,copperDown=inventory(g.scienceUp,g.science,'copper-plate',scienceIngredients['copper-plate'],g.stockSegment);local copperProduced=g.scienceUp[s.terminals['copper-plate'].unit_number] and s.injected['copper-plate'] or 0
  stages['copper-plate']=reading('terminal-copper-plate','science-input-copper-plate','collector-science-chain',copperProduced,copperFlow[s.terminals['copper-plate'].unit_number] and copperProduced or 0,g.delivered['copper-plate'],science*scienceIngredients['copper-plate'],copperUp,copperDown)
  stages['automation-science-pack']=reading('connected-science-machines','automatic-collector','collector-drain',science,machine_products(causalScience,'automation-science-pack'),s.collected,s.collected,science_inventory(g),zero())
 else
  local gearUp,gearDown=inventory(g.scienceUp,g.science,'iron-gear-wheel',scienceIngredients['iron-gear-wheel'],g.stockSegment)
  local produced=g.scienceUp[s.terminals['iron-gear-wheel'].unit_number] and s.injected['iron-gear-wheel'] or 0
  stages['iron-gear-wheel']=reading('terminal-iron-gear-wheel','science-input-iron-gear-wheel','collector-science-chain',produced,produced,g.delivered['iron-gear-wheel'],science*scienceIngredients['iron-gear-wheel'],gearUp,gearDown)
  local copperUp,copperDown=inventory(g.scienceUp,g.science,'copper-plate',scienceIngredients['copper-plate'],g.stockSegment);local copperProduced=g.scienceUp[s.terminals['copper-plate'].unit_number] and s.injected['copper-plate'] or 0
  stages['copper-plate']=reading('terminal-copper-plate','science-input-copper-plate','collector-science-chain',copperProduced,copperProduced,g.delivered['copper-plate'],science*scienceIngredients['copper-plate'],copperUp,copperDown)
  stages['automation-science-pack']=reading('connected-science-machines','automatic-collector','collector-drain',science,science,s.collected,s.collected,science_inventory(g),zero())
 end
 local invalid=v.state~='admitted';local result={tick=game.tick,sequence=g.sequence,scope=v.scope,continuous=not invalid,coverage=invalid and 'missing' or 'complete',machineScience=science,automaticCollector=s.collected,collectorReverse=0,manualSupply=0,artificialOutput=0,humanEdits=invalid and 1 or 0,stages=stages}
 g.sequence=g.sequence+1;g.samples[#g.samples+1]=result
end
function M.admit()
 local s=storage.af.scenario;if not s then return end
 local g=graph(s);s.measurement=g;for id in pairs(g.hands) do g.hands[id]=hand(g.entities[id]) end
 g.actors={};for id,index in pairs(storage.af.actors) do local p=game.get_player(index);C.check(p and p.connected and p.character,'measurement_actor_disconnected');g.actors[id]=actor_inventory(p) end
 g.admitted=game.tick;g.next=game.tick+storage.af.verification.settlingTicks;sample(s,g)
end
function M.tick()
 local s=storage.af.scenario;local g=s and s.measurement;if not g or g.finished or g.error then return end
 local ok,err=pcall(function()
  for id,baseline in pairs(g.actors) do local p=game.get_player(storage.af.actors[id]);C.check(p and p.connected and p.character,'measurement_actor_disconnected');C.check(C.same(baseline,actor_inventory(p)),'measurement_character_inventory_changed') end
  for id,previous in pairs(g.hands) do
   local e=g.entities[id];C.check(e.valid,'measurement_inserter_removed');local current=hand(e)
   if previous.count>0 and (previous.name~=current.name or previous.quality~=current.quality or previous.count>current.count) then
    local dropped=previous.count-((current.name==previous.name and current.quality==previous.quality) and current.count or 0);local target=e.drop_target
    if dropped>0 and previous.source and target and target.unit_number then local edges=g.flowReverse[previous.name] or {};g.flowReverse[previous.name]=edges;local source=g.entities[previous.source];if source then edges[e.unit_number]=edges[e.unit_number] or {};edges[e.unit_number][source.unit_number]=true;edges[target.unit_number]=edges[target.unit_number] or {};edges[target.unit_number][e.unit_number]=true end end
    if target and (g.science[target.unit_number] or g.gears[target.unit_number]) then C.check(previous.quality=='normal','unsupported_quality_flow');g.delivered[previous.name]=(g.delivered[previous.name] or 0)+dropped end
   end
   g.hands[id]=current
  end
  if game.tick==g.next then sample(s,g);g.next=g.next+3600;if #g.samples==7 then g.finished=true end elseif game.tick>g.next then error('missing_exact_measurement_tick',0) end
 end)
 if not ok then g.error=tostring(err);V.invalidate('measurement:'..g.error) end
end
function M.read(r)
 C.keys(r,{'op','after'});C.integer(r.after,-1,2147483647)
 local g=storage.af.scenario and storage.af.scenario.measurement;C.check(g,'measurement_not_admitted')
 local samples={};for _,s in ipairs(g.samples) do if s.sequence>r.after then samples[#samples+1]=s end end
 return {ok=true,tick=game.tick,samples=samples,error=g.error,finished=g.finished==true,guard=storage.af.verification.state}
end
return M
