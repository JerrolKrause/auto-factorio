local C=require("common")
local A=require("actions")
local F=require("ownership")
local V=require("verification")
local M={}
local done,receipt
function M.bind(d,r) done=d;receipt=r end
function M.init()
 storage.af.control={armed=false,revision=0,generation=1,ready=false,origin=game.tick,scenarioElapsed=0,injections=0,lastHeartbeat=game.ticks_played,timeout=180,checkpoint=false}
end
function M.check(r)
 C.check(r.epoch==storage.af.epoch and r.session==storage.af.session,"stale_epoch_or_session")
 C.check(r.revision==storage.af.control.revision,"stale_control_revision")
end
function M.disarm(reason,pause)
 -- An ordinary pause preserves the interval; a lost heartbeat creates an evidence gap.
 if reason~='operator_pause' then V.invalidate(reason) end
 local c=storage.af.control;c.armed=false;c.ready=false;c.revision=c.revision+1;c.reason=reason;c.checkpoint=false
 local ids={};for _,id in pairs(storage.af.active) do ids[#ids+1]=id end
 for _,id in ipairs(ids) do
  local o=storage.af.orders[id];local pending={};for i=o.completed+1,#o.batch.steps do pending[#pending+1]=o.batch.steps[i] end
  done(o,"cancelled",reason);o.status="suspended";o.pending=pending
 end
 for _,index in pairs(storage.af.actors) do local p=game.get_player(index);if p and p.character then A.neutral(p,true) end end
 storage.af.paths={}
 -- A second pause while already frozen cannot rely on another on_tick callback
 -- to clear the latch: that callback would otherwise immediately re-pause arm.
 if pause then c.pausePending=not game.tick_paused end
end
function M.tick()
 local c=storage.af.control
 if c.armed and game.ticks_played-c.lastHeartbeat>c.timeout then M.disarm("heartbeat_expired",false) end
 if c.pausePending then
  for _,index in pairs(storage.af.actors) do local p=game.get_player(index);if p and p.character then A.neutral(p,true) end end
  if M.state().neutral then game.tick_paused=true;game.ticks_to_run=0;c.pausePending=false end
  c.scenarioElapsed=game.tick-c.origin;c.injections=math.floor(c.scenarioElapsed/60)
  return false
 end
 if game.tick_paused then return false end
 c.scenarioElapsed=game.tick-c.origin;c.injections=math.floor(c.scenarioElapsed/60)
 return c.armed
end
function M.state()
 local c=storage.af.control;local ledger={};local intents={};local neutral=true
 for id,o in pairs(storage.af.orders) do ledger[id]=receipt(o);if o.status=="suspended" then intents[id]=o.pending end end
 for _,index in pairs(storage.af.actors) do local p=game.get_player(index);if p and p.character then
  neutral=neutral and not p.walking_state.walking and not p.mining_state.mining and (not p.crafting_queue or #p.crafting_queue==0)
 end end
 local production={}
 if c.fixture then local e=game.surfaces.nauvis.find_entity("stone-furnace",{x=-6.5,y=-5.5});if e then production={output=C.inventory(e.get_inventory(defines.inventory.furnace_result)),input=C.inventory(e.get_inventory(defines.inventory.furnace_source)),fuel=C.inventory(e.get_inventory(defines.inventory.fuel)),progress=e.crafting_progress,finished=e.products_finished} end end
 return {ok=true,epoch=storage.af.epoch,session=storage.af.session,revision=c.revision,generation=c.generation,armed=c.armed,ready=c.ready,reason=c.reason,paused=game.tick_paused,ticksToRun=game.ticks_to_run,tick=game.tick,ticksPlayed=game.ticks_played,experimentTick=game.tick-c.origin,scenarioElapsed=c.scenarioElapsed,injections=c.injections,neutral=neutral,checkpoint=c.checkpoint,ledger=ledger,intents=intents,production=production,mods=script.active_mods}
end
function M.rpc(r)
 local c=storage.af.control
 if r.op=="state" then C.keys(r,{"op"});return M.state() end
 if r.op=="resume-verification" then
  C.keys(r,{"op","epoch","session","revision"});M.check(r)
  local v=storage.af.verification
  -- Only a neutral ordinary pause of an admitted observation-only interval may
  -- retain its baseline. Restores, watchdog loss and construction use reconciliation.
  C.check(v and v.state=='admitted' and c.reason=='operator_pause' and not c.checkpoint,'verification_resume_requires_ordinary_pause')
  C.check(not c.armed and game.tick_paused and game.ticks_to_run==0 and M.state().neutral and next(storage.af.active)==nil,'verification_resume_requires_barrier')
  for _,o in pairs(storage.af.orders) do C.check(o.status~='suspended','verification_resume_has_pending_order') end
  c.armed=true;c.ready=false;c.revision=c.revision+1;c.lastHeartbeat=game.ticks_played;c.pausePending=false
  game.ticks_to_run=0;game.tick_paused=false
  return M.state()
 end
 if r.op=="fixture" then
  C.keys(r,{"op"});C.check(not c.armed and not c.fixture and next(storage.af.orders)==nil,"fixture_requires_fresh_disarmed_world")
  local e=game.surfaces.nauvis.create_entity{name="stone-furnace",position={-6.5,-5.5},force="player"};C.check(e,"fixture_collision")
  storage.af.protected[e.unit_number]=true;e.get_inventory(defines.inventory.furnace_source).insert{name="iron-ore",count=100};e.get_inventory(defines.inventory.fuel).insert{name="coal",count=50};c.fixture=true
  return M.state()
 end
 if r.op=="pause" or r.op=="heartbeat" or r.op=="arm" then
  C.keys(r,{"op","epoch","session","revision"});M.check(r)
  if r.op=="pause" then M.disarm("operator_pause",true)
  elseif r.op=="heartbeat" then c.lastHeartbeat=game.ticks_played
  else
   C.check(c.ready and not c.armed and game.tick_paused and game.ticks_to_run==0,"reconciliation_required")
   C.check(next(storage.af.active)==nil,"pending_execution")
   c.armed=true;c.ready=false;c.revision=c.revision+1;c.checkpoint=false;c.lastHeartbeat=game.ticks_played;game.ticks_to_run=0;game.tick_paused=false
  end
  return M.state()
 end
 if r.op=="capture" then
  C.keys(r,{"op","epoch","session","revision","name"});M.check(r);C.id(r.name)
  C.check(not c.armed and not c.ready and game.tick_paused and game.ticks_to_run==0 and M.state().neutral,"capture_requires_disarmed_pause")
  c.checkpoint=r.name;game.server_save(r.name);return M.state()
 end
 if r.op=="reconcile" then
  C.keys(r,{"op","epoch","session","revision","checkpoint","ledger","newEpoch","newSession","generation"});M.check(r)
  C.id(r.newEpoch);C.id(r.newSession);C.integer(r.generation,1,2147483647)
  C.check(not c.armed and game.tick_paused and game.ticks_to_run==0 and M.state().neutral,"reconcile_requires_barrier")
  C.check(r.checkpoint==c.checkpoint,"checkpoint_mismatch");C.check(C.same(r.ledger,M.state().ledger),"ledger_mismatch")
  C.check(r.newEpoch~=storage.af.epoch and r.newSession~=storage.af.session and r.generation==c.generation+1,"fresh_authority_required")
  V.invalidate('authority_replaced_requires_new_baseline')
  -- Interrupted timed work is never replayed: its world effects and refunds are in the saved receipt.
  for _,o in pairs(storage.af.orders) do if o.status=="suspended" then o.status="cancelled";o.reason="reconciled_requires_new_command";o.pending=nil end end
  storage.af.active={};storage.af.paths={};storage.af.epoch=r.newEpoch;storage.af.session=r.newSession;c.generation=r.generation;c.revision=c.revision+1;c.ready=true;c.checkpoint=false
  F.reset()
  return M.state()
 end
 error("unsupported_control_operation",0)
end
return M
