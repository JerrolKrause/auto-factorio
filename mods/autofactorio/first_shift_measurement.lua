-- Private engine telemetry. Topology selects a scope, but only observed transfers
-- and independently reconciled inventories establish delivery through that scope.
local C=require('common')
local V=require('verification')
local M={}
local items={'iron-gear-wheel','copper-plate'}
local belt={['transport-belt']=true,['underground-belt']=true,splitter=true}
local function zero() return {containers=0,belts=0,hands=0,inProcess=0} end
local function count(inv,item) return inv and inv.get_item_count{name=item,quality='normal'} or 0 end
local function ancestors(edges,seeds)
 local seen={};local pending={};for id in pairs(seeds) do seen[id]=true;pending[#pending+1]=id end
 local i=1;while i<=#pending do local id=pending[i];i=i+1;for parent in pairs(edges[id] or {}) do if not seen[parent] then seen[parent]=true;pending[#pending+1]=parent end end end
 return seen
end
local function graph(s)
 local entities={};local reverse={}
 for _,e in pairs(game.surfaces.nauvis.find_entities_filtered{area={{-32,-32},{32,32}},force='player'}) do if e.unit_number then entities[e.unit_number]=e end end
 local function edge(a,b)
  if a and b and a.valid and b.valid and entities[a.unit_number] and entities[b.unit_number] then local id=b.unit_number;reverse[id]=reverse[id] or {};reverse[id][a.unit_number]=true end
 end
 for _,e in pairs(entities) do
  if belt[e.type] then
   for _,out in pairs(e.belt_neighbours.outputs) do edge(e,out) end
   if e.type=='underground-belt' and e.belt_to_ground_type=='input' then edge(e,e.neighbours) end
  elseif e.type=='inserter' then edge(e.pickup_target,e);edge(e,e.drop_target) end
 end
 local output=ancestors(reverse,{[s.collector.unit_number]=true})
 local machines={};local seeds={}
 for id,e in pairs(entities) do
  if e.type=='assembling-machine' and output[id] then
   local recipe=e.get_recipe()
   if recipe and recipe.name=='automation-science-pack' then machines[id]=e;seeds[id]=true end
  end
 end
 local upstream=ancestors(reverse,seeds)
 for id in pairs(machines) do upstream[id]=nil end
 local scoped={};for id in pairs(upstream) do scoped[id]=entities[id] end
 local outputEntities={};for id in pairs(output) do outputEntities[id]=entities[id] end
 return {entities=entities,upstream=scoped,output=outputEntities,machines=machines,delivered={['iron-gear-wheel']=0,['copper-plate']=0},hands={},samples={},sequence=0}
end
local function inventory(g,item)
 local up=zero();local down=zero()
 for _,e in pairs(g.upstream) do
  C.check(e.valid,'measurement_entity_removed')
  if belt[e.type] then
   for i=1,e.get_max_transport_line_index() do up.belts=up.belts+e.get_transport_line(i).get_item_count{name=item,quality='normal'} end
  elseif e.type=='container' then up.containers=up.containers+count(e.get_inventory(defines.inventory.chest),item)
  elseif e.type=='inserter' then local h=e.held_stack;if h.valid_for_read and h.name==item and h.quality.name=='normal' then up.hands=up.hands+h.count end
  else error('unsupported_upstream_inventory:'..e.type,0) end
 end
 for _,e in pairs(g.machines) do
  C.check(e.valid,'measurement_machine_removed')
  down.containers=down.containers+count(e.get_inventory(defines.inventory.assembling_machine_input),item)
  if e.is_crafting() then down.inProcess=down.inProcess+g.ingredients[item] end
 end
 return up,down
end
local function hand(e)
 local h=e.held_stack;return h.valid_for_read and {name=h.name,quality=h.quality.name,count=h.count} or {count=0}
end
local function science_inventory(g)
 local stock=zero()
 for _,e in pairs(g.output) do
  C.check(e.valid,'measurement_output_entity_removed')
  if belt[e.type] then
   for i=1,e.get_max_transport_line_index() do stock.belts=stock.belts+e.get_transport_line(i).get_item_count{name='automation-science-pack',quality='normal'} end
  elseif e.type=='container' then stock.containers=stock.containers+count(e.get_inventory(defines.inventory.chest),'automation-science-pack')
  elseif e.type=='assembling-machine' then stock.containers=stock.containers+count(e.get_inventory(defines.inventory.assembling_machine_output),'automation-science-pack')
  elseif e.type=='inserter' then local h=e.held_stack;if h.valid_for_read and h.name=='automation-science-pack' and h.quality.name=='normal' then stock.hands=stock.hands+h.count end
  else error('unsupported_output_inventory:'..e.type,0) end
 end
 return stock
end
local function actor_inventory(p)
 local cursor=p.cursor_stack
 return {main=C.inventory(p.get_main_inventory()),cursor=cursor.valid_for_read and {name=cursor.name,quality=cursor.quality.name,count=cursor.count} or {}}
end
local function sample(s,g)
 local v=storage.af.verification
 local science=0;for _,e in pairs(g.machines) do C.check(e.valid,'measurement_machine_removed');science=science+e.products_finished*g.product end
 local stages={}
 for _,item in ipairs(items) do
  local up,down=inventory(g,item)
  stages[item]={source='terminal-'..item,boundary='science-input-'..item,consumer='collector-science-chain',produced=g.upstream[s.terminals[item].unit_number] and s.injected[item] or 0,forward=g.delivered[item],reverse=0,consumed=science/g.product*g.ingredients[item],upstream=up,downstream=down,coverage='complete'}
 end
 -- Reconcile the output route too: possible connectivity plus matching unrelated
 -- production cannot stand in for actual delivery to the draining collector.
 stages['automation-science-pack']={source='connected-science-machines',boundary='automatic-collector',consumer='collector-drain',produced=science,forward=s.collected,reverse=0,consumed=s.collected,upstream=science_inventory(g),downstream=zero(),coverage='complete'}
 local invalid=v.state~='admitted'
 local result={tick=game.tick,sequence=g.sequence,scope=v.scope,continuous=not invalid,coverage=invalid and 'missing' or 'complete',machineScience=science,automaticCollector=s.collected,collectorReverse=0,manualSupply=0,artificialOutput=0,humanEdits=invalid and 1 or 0,stages=stages}
 g.sequence=g.sequence+1;g.samples[#g.samples+1]=result
end
function M.admit()
 local s=storage.af.scenario;if not s then return end
 local g=graph(s);s.measurement=g
 local recipe=game.forces.player.recipes['automation-science-pack'];g.ingredients={}
 C.check(#recipe.products==1 and recipe.products[1].name=='automation-science-pack' and (recipe.products[1].probability or 1)==1,'unsupported_science_product')
 g.product=recipe.products[1].amount;C.check(g.product and g.product>0,'unsupported_science_amount')
 for _,i in pairs(recipe.ingredients) do C.check(i.type=='item','unsupported_science_ingredient');g.ingredients[i.name]=i.amount end
 C.check(g.ingredients[items[1]] and g.ingredients[items[2]] and #recipe.ingredients==2,'unsupported_science_recipe')
 for id,e in pairs(g.upstream) do if e.type=='inserter' then g.hands[id]=hand(e) end end
 g.actors={}
 for id,index in pairs(storage.af.actors) do local p=game.get_player(index);C.check(p and p.connected and p.character,'measurement_actor_disconnected');g.actors[id]=actor_inventory(p) end
 g.admitted=game.tick;g.next=game.tick+storage.af.verification.settlingTicks
 sample(s,g)
end
function M.tick()
 local s=storage.af.scenario;local g=s and s.measurement
 if not g or g.finished or g.error then return end
 local ok,err=pcall(function()
  for id,baseline in pairs(g.actors) do
   local p=game.get_player(storage.af.actors[id]);C.check(p and p.connected and p.character,'measurement_actor_disconnected')
   C.check(C.same(baseline,actor_inventory(p)),'measurement_character_inventory_changed')
  end
  for id,previous in pairs(g.hands) do
   local e=g.entities[id];C.check(e.valid,'measurement_inserter_removed');local current=hand(e)
   if previous.count>0 and (previous.name~=current.name or previous.quality~=current.quality or previous.count>current.count) then
    local dropped=previous.count-((current.name==previous.name and current.quality==previous.quality) and current.count or 0)
    if g.machines[e.drop_target and e.drop_target.unit_number] and g.delivered[previous.name] then
     C.check(previous.quality=='normal','unsupported_quality_flow')
     g.delivered[previous.name]=g.delivered[previous.name]+dropped
    end
   end
   g.hands[id]=current
  end
  if game.tick==g.next then sample(s,g);g.next=g.next+3600;if #g.samples==7 then g.finished=true end
  elseif game.tick>g.next then error('missing_exact_measurement_tick',0) end
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
