local C=require("common")
local A=require("actions")
local L=require("lifecycle")
local F=require("ownership")
local V=require("verification")
local S=require("first_shift")
local SM=require("first_shift_measurement")
local O=require("operational")
local function setup()
 if remote.interfaces.freeplay then
  remote.call("freeplay","set_skip_intro",true);remote.call("freeplay","set_disable_crashsite",true);remote.call("freeplay","set_created_items",{})
 end
 local surface=game.surfaces.nauvis
 surface.request_to_generate_chunks({0,0},2);surface.force_generate_chunk_requests()
 for _,e in pairs(surface.find_entities_filtered{area={{-34,-34},{34,34}}}) do if e.type~="character" then e.destroy() end end
 local tiles={};for x=-34,34 do for y=-34,34 do tiles[#tiles+1]={name="grass-1",position={x,y}} end end;surface.set_tiles(tiles)
 surface.always_day=true
 storage.af={epoch="phase03",session="local-test",actors={},orders={},active={},paths={},protected={}}
 L.init()
 F.init()
 local function fixture(name,pos)
  local e=surface.create_entity{name=name,position=pos,force="player"};storage.af.protected[e.unit_number or (e.name..":"..e.position.x..":"..e.position.y)]=true;return e
 end
 fixture("steel-chest",{3.5,-3.5}).insert{name="iron-plate",count=7,quality="normal"}
 for y=-3,3 do fixture("stone-wall",{8.5,y+0.5}) end
 surface.create_entity{name="iron-ore",position={-3.5,2.5},amount=100,force="neutral"}
end
script.on_init(setup)
local E=require('edits')
for _,entry in ipairs({{defines.events.on_built_entity,'build'},{defines.events.on_player_mined_entity,'mine'},{defines.events.on_player_rotated_entity,'rotate'},{defines.events.on_entity_settings_pasted,'settings'},{defines.events.on_player_built_tile,'tile-build'},{defines.events.on_player_mined_tile,'tile-mine'}}) do
 local kind=entry[2]
 script.on_event(entry[1],function(event) E.record(event,kind) end)
end
script.on_event(defines.events.on_player_created,function(event)
 local p=game.get_player(event.player_index);if not p.character then p.set_controller{type=defines.controllers.god};p.create_character() end
 if not S.player(p) then
 p.teleport({0,0},"nauvis");p.force.research_all_technologies();p.get_main_inventory().clear()
 for name,count in pairs({["transport-belt"]=30,["assembling-machine-1"]=3,["wooden-chest"]=5,["iron-plate"]=100,["copper-plate"]=20,["coal"]=20,["stone-furnace"]=2}) do p.insert{name=name,count=count,quality="normal"} end
 end
 storage.af.actors["builder-"..event.player_index]=event.player_index
 p.print("AutoFactorio phase 03: dedicated test kit; normal character speed, reach and timing. Structured RPC ready.")
end)
local function inventory(p) return C.inventory(p.get_main_inventory()) end
local function done(o,status,reason)
 local p=game.get_player(storage.af.actors[o.batch.actor]); if p and p.character then A.neutral(p,true) end
 if o.work then
   local after=p and p.character and inventory(p) or {};local w=o.work
   o.steps[#o.steps+1]={index=o.completed+1,status=status=="completed" and "completed" or (status=="cancelled" and "cancelled" or "failed"),reason=reason,startedTick=w.startedTick,endedTick=game.tick,before=w.before,after=after,delta=C.delta(w.before,after)}
 end
 o.status=status;o.reason=reason;o.endedTick=game.tick;o.unexecuted=#o.batch.steps-#o.steps;storage.af.active[o.batch.actor]=nil;o.work=nil
end
local function receipt(o)
 if not o then return nil end
 return {commandId=o.commandId,status=o.status,reason=o.reason,acceptedTick=o.acceptedTick,endedTick=o.endedTick,completed=o.completed,unexecuted=o.unexecuted,steps=o.steps}
end
local function authority(b)
 return F.authority(b)
end
L.bind(done,receipt)
F.bind(done,receipt)
V.bind(done,receipt,A.neutral,SM.admit)
local function submit(b)
 C.keys(b,{"commandId","epoch","session","task","revision","actor","surface","grants","deadline","steps"});for _,key in ipairs({"commandId","epoch","session","task","actor","surface"}) do C.id(b[key]) end
 C.integer(b.revision,1,2147483647);C.integer(b.deadline,1,2147483647);C.check(type(b.grants)=="table" and #b.grants>=3 and #b.grants<=32,"incomplete_reservation_set")
 C.check(type(b.steps)=="table" and #b.steps>=1 and #b.steps<=100,"batch_size");for k,s in pairs(b.steps) do C.integer(k,1,#b.steps);A.validate(s) end
 C.check(b.epoch==storage.af.epoch and b.session==storage.af.session,"stale_epoch_or_session")
 local existing=storage.af.orders[b.commandId]
 if existing then C.check(C.same(existing.batch,b),"command_id_conflict");return receipt(existing) end
 C.check(storage.af.control.armed and not game.tick_paused,"executor_disarmed");local p=authority(b)
 for _,s in ipairs(b.steps) do V.guard(s);S.guard(s) end
 C.check(b.deadline>game.tick and b.deadline<=game.tick+36000,"invalid_deadline");C.check(not storage.af.active[b.actor],"actor_busy")
 local n=0;for _ in pairs(storage.af.orders) do n=n+1 end;C.check(n<200,"receipt_capacity")
 C.check(not p.crafting_queue or #p.crafting_queue==0,"crafting_busy")
 local o={commandId=b.commandId,batch=b,status="accepted",acceptedTick=game.tick,completed=0,unexecuted=#b.steps,steps={}}
 storage.af.orders[b.commandId]=o;storage.af.active[b.actor]=b.commandId;return receipt(o)
end
script.on_event(defines.events.on_tick,function()
 local armed=L.tick()
 S.tick()
 SM.tick()
 O.tick()
 if not armed then return end
 for actor,id in pairs(storage.af.active) do
  local o=storage.af.orders[id]
  -- Synchronous player build/rotation events can identify the executor that caused them.
  storage.af.executing=id
  local ok,result=pcall(function()
   local p=authority(o.batch);C.check(game.tick<=o.batch.deadline,"deadline_exceeded");o.status="running"
   local step=o.batch.steps[o.completed+1]
   V.guard(step)
   S.guard(step)
   if not o.work then o.work={startedTick=game.tick,before=inventory(p)} end
   if A.tick(p,o,step) then
    A.neutral(p,false);local after=inventory(p);o.steps[#o.steps+1]={index=o.completed+1,status="completed",startedTick=o.work.startedTick,endedTick=game.tick,before=o.work.before,after=after,delta=C.delta(o.work.before,after)}
    o.completed=o.completed+1;o.unexecuted=#o.batch.steps-o.completed;o.work=nil
    if o.completed==#o.batch.steps then done(o,"completed") end
   end
  end)
  storage.af.executing=nil
  if not ok then done(o,o.completed>0 and "partial" or "failed",tostring(result)) end
 end
end)
script.on_event(defines.events.on_script_path_request_finished,function(e)
 local id=storage.af.paths[e.id];storage.af.paths[e.id]=nil;local o=id and storage.af.orders[id]
 if not o or not o.work or o.work.request~=e.id then return end
 local w=o.work;if not e.path then w.pathFailed=true;return end
 w.path={};for _,v in ipairs(e.path) do
  local ok=pcall(function()F.movement(o.batch,C.actor(o.batch.actor),v.position,0)end)
  if not ok then w.pathFailed=true;return end
  w.path[#w.path+1]=v.position
 end;w.waypoint=1
end)
script.on_event(defines.events.on_player_mined_item,function(e)
 local id=storage.af.active["builder-"..e.player_index];local o=id and storage.af.orders[id]
 if o and o.work and o.batch.steps[o.completed+1].kind=="mine" then o.work.mined=true end
end)
local function observe(r)
 C.keys(r,{"op","surface","area","offset","limit"});C.check(r.surface=="nauvis","surface_not_assigned");C.check(type(r.area)=="table" and #r.area==2,"invalid_area");C.pos(r.area[1]);C.pos(r.area[2]);C.check(r.area[1].x<=r.area[2].x and r.area[1].y<=r.area[2].y,"reversed_area");C.integer(r.offset,0,10000);C.integer(r.limit,1,50)
 local entities=game.surfaces[r.surface].find_entities_filtered{area=r.area};table.sort(entities,function(a,b)return (a.name..":"..a.position.x..":"..a.position.y)<(b.name..":"..b.position.x..":"..b.position.y) end)
 local out={};for i=r.offset+1,math.min(#entities,r.offset+r.limit) do local e=entities[i];local ref=C.ref(e);ref.protected=C.protected(e);ref.direction=e.direction;ref.type=e.type;ref.inventories={}
  for name in pairs(C.inventory_ids) do local ok,inv=pcall(function()return C.entity_inventory(e,name)end);if ok and inv then ref.inventories[name]=C.inventory(inv) end end
  if e.type=="assembling-machine" then local recipe=e.get_recipe();ref.recipe=recipe and recipe.name;ref.craftingSpeed=e.crafting_speed;ref.status=tostring(e.status);ref.power=e.electric_network_id and e.energy or nil end
  if e.type=="underground-belt" then ref.beltType=e.belt_to_ground_type;ref.neighbour=e.neighbours and C.ref(e.neighbours) end
  out[#out+1]=ref
 end
 local actors={};for id,index in pairs(storage.af.actors) do local p=game.get_player(index);if p and p.character then actors[id]={position=p.position,surface=p.surface.name,inventory=inventory(p),walking=p.walking_state,mining=p.mining_state,crafting=p.crafting_queue or {},buildDistance=p.build_distance,reachDistance=p.reach_distance,runningSpeed=p.character_running_speed,miningSpeed=p.character_mining_speed_modifier,craftingSpeed=p.character_crafting_speed_modifier,connected=p.connected} end end
 return {ok=true,epoch=storage.af.epoch,session=storage.af.session,tick=game.tick,ticksPlayed=game.ticks_played,surface=r.surface,scope=r.area,coverage="entities in bounded area; player main inventories",freshness="current tick; pages are independent live reads",offset=r.offset,total=#entities,nextOffset=r.offset+r.limit<#entities and r.offset+r.limit or nil,truncated=r.offset+r.limit<#entities,entities=out,actors=actors,mods=script.active_mods,loadedReadOnly=not storage.af.control.armed}
end
local function gameplay(r)
 C.check(type(r)=="table","invalid_request")
 if r.op=="observe" then return observe(r)
 elseif r.op=="operational-register" then C.keys(r,{"op","scope","sampleTicks","historySamples"});return O.register(r)
 elseif r.op=="operational-read" then C.keys(r,{"op","scopeId","scopeRevision","afterTick"});return O.read(r)
 elseif r.op=="submit" then C.keys(r,{"op","batch"});return {ok=true,receipt=submit(r.batch)}
 elseif r.op=="receipt" or r.op=="cancel" then
  if r.op=="cancel" then C.keys(r,{"op","commandId","epoch","session"});C.check(r.epoch==storage.af.epoch and r.session==storage.af.session,"stale_epoch_or_session") else C.keys(r,{"op","commandId"}) end;C.id(r.commandId);local o=storage.af.orders[r.commandId]
  if r.op=="cancel" and o and (o.status=="accepted" or o.status=="running" or o.status=="suspended") then done(o,"cancelled","operator_cancelled");o.pending=nil end
  return {ok=true,receipt=receipt(o)}
 elseif r.op=="recipe" then
 C.keys(r,{"op","name"});C.id(r.name);local recipe=game.forces.player.recipes[r.name];C.check(recipe,"recipe_not_found")
  return {ok=true,tick=game.tick,mods=script.active_mods,recipe={name=recipe.name,energy=recipe.energy,category=recipe.category,ingredients=recipe.ingredients,products=recipe.products,enabled=recipe.enabled}}
 end
 error("unsupported_gameplay_operation",0)
end
local function encoded(fn,payload,operator)
 local ok,result=pcall(function()
  C.check(type(payload)=="string" and #payload<=(operator and 4194304 or 65536),"invalid_payload")
  local r=helpers.json_to_table(payload)
  -- A verified held receipt ledger can exceed the ordinary action-batch limit.
  C.check(#payload<=65536 or (operator and r.op=="reconcile"),"invalid_payload")
  return fn(r)
 end)
 return helpers.table_to_json(ok and result or {ok=false,error=tostring(result),tick=game.tick})
end
remote.add_interface("autofactorio_v1",{rpc=function(payload)return encoded(gameplay,payload)end})
-- Operator-only diagnostics are never exposed through the gameplay validator/gateway.
remote.add_interface("autofactorio_operator_v1",{rpc=function(payload)return encoded(function(r)
 if r.op=="scenario" then return S.rpc(r) end
 if r.op=="scenario-measurements" then return SM.read(r) end
 if r.op=="operational-raw-counters" then C.keys(r,{"op","area"});return O.raw(r.area) end
 if r.op=="verification" then return V.rpc(r) end
 if r.op=="edits" then C.keys(r,{"op","after"});C.integer(r.after,0,2147483647);return E.read(r.after) end
 if r.op=="ownership" then C.keys(r,{"op","control"});return {ok=true,ack=F.control(r.control)} end
 if r.op~="save" and r.op~="screenshot" then return L.rpc(r) end
 C.keys(r,{"op","name"});C.id(r.name)
 if r.op=="screenshot" then game.take_screenshot{player=game.players[1],position={0,0},resolution={1280,800},zoom=1,show_entity_info=true,path=r.name..".png"};return {ok=true}
 elseif r.op=="save" then C.check(next(storage.af.active)==nil,"active_orders_cannot_save");for _,index in pairs(storage.af.actors) do local p=game.get_player(index);A.neutral(p,true) end;game.server_save(r.name);return {ok=true,requestedTick=game.tick}
 end
 error("unsupported_operator_operation",0)
end,payload,true)end})
