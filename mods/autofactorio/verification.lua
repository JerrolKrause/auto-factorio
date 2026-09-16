-- Evaluator/operator capability only. This module guards execution; it does not claim
-- calibrated science/flow telemetry (scenario instrumentation arrives in phase 11).
local C=require('common')
local V={}
local done,receipt,neutral,capture
function V.bind(d,r,n,c) done=d;receipt=r;neutral=n;capture=c end
local function current() return storage.af.verification end
local function held(v) return v and v.state~='building' and v.state~='aborted' end
function V.guard(s)
 local v=current();if not v then return end
 if s.kind=='craft' then
  local recipe=game.forces.player.recipes[s.recipe]
  if recipe then for _,p in pairs(recipe.products) do
   local item=prototypes.item[p.name]
   C.check(not item or item.type~='tool','manual_science_prohibited')
  end end
 end
 C.check(not held(v) or s.kind=='walk','verification_observation_only')
end
function V.invalidate(reason)
 local v=current()
 if v and (v.state=='admitted' or v.state=='admitting') then v.state='invalid';v.reason=reason;v.invalidTick=game.tick end
end
local function state()
 local v=current();C.check(v,'benchmark_not_configured')
 return {ok=true,verification=v,tick=game.tick}
end
function V.rpc(r)
 local c=storage.af.control
 C.check(r.epoch==storage.af.epoch and r.session==storage.af.session and r.revision==c.revision,'stale_verification_authority')
 if r.action=='configure' then
  C.keys(r,{'op','action','epoch','session','revision','scope','version','settlingTicks'})
  C.id(r.scope);C.id(r.version);C.integer(r.settlingTicks,0,36000)
  C.check(not c.armed and not current(),'benchmark_requires_fresh_disarmed_world')
  storage.af.verification={state='building',scope=r.scope,version=r.version,settlingTicks=r.settlingTicks,attempts={}}
  return state()
 end
 C.check(current(),'benchmark_not_configured')
 if r.action=='state' then C.keys(r,{'op','action','epoch','session','revision'});return state() end
 C.keys(r,{'op','action','epoch','session','revision','attempt'});C.id(r.attempt)
 local v=current()
 if r.action=='admit' then
  -- An unknown response is read back with state. A duplicate cannot reset baselines.
  if v.attempt==r.attempt then return state() end
  C.check(not v.attempts[r.attempt],'attempt_id_reused')
  C.check(v.state=='building' or v.state=='aborted','repair_required_before_new_attempt')
  C.check(c.armed and not game.tick_paused,'executor_disarmed')
  v.state='admitting';v.attempt=r.attempt;v.attempts[r.attempt]=true
  local ids={};for _,id in pairs(storage.af.active) do ids[#ids+1]=id end
  local receipts={}
  for _,id in ipairs(ids) do local o=storage.af.orders[id];done(o,'cancelled','verification_admission');receipts[#receipts+1]=receipt(o) end
  local actors={}
  for id,index in pairs(storage.af.actors) do local p=game.get_player(index)
   if p and p.character then
    neutral(p,true)
    C.check(not p.walking_state.walking and not p.mining_state.mining and (not p.crafting_queue or #p.crafting_queue==0),'verification_neutral_unconfirmed')
    actors[id]=C.inventory(p.get_main_inventory())
   end
  end
  C.check(next(storage.af.active)==nil,'pending_verification_mutation')
  storage.af.paths={}
  v.state='admitted';v.reason=nil;v.invalidTick=nil
  v.baseline={attempt=r.attempt,scope=v.scope,tick=game.tick,mutationsClosed=true,pendingMutations=0,neutral=true,actors=actors,receipts=receipts,coverage='character inventories and final receipts only; calibrated factory measurement unavailable'}
  if capture then
   local ok,err=pcall(capture)
   if not ok then V.invalidate('measurement_admission:'..tostring(err));error(tostring(err),0) end
  end
 elseif r.action=='repair' then
  C.check(v.attempt==r.attempt,'attempt_mismatch')
  -- Terminal state is committed before mutation admission reopens.
  v.state='aborted';v.reason='repair_requested';v.abortTick=game.tick
 elseif r.action=='invalidate' then
  C.check(v.attempt==r.attempt,'attempt_mismatch');V.invalidate('operator_invalidated')
 else error('unsupported_verification_action',0) end
 return state()
end
return V
