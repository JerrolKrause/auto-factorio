local C=require("common")
local M={}
local done,receipt
function M.bind(d,r) done=d;receipt=r end
function M.init() storage.af.ownership={grants={},tasks={},requests={},assignments={}} end
local function state() return storage.af.ownership end
local function overlap(a,b)
 if a.kind~=b.kind then return false end
 if a.kind~="area" then return a.actor==b.actor end
 return a.surface==b.surface and a.bounds[1].x<=b.bounds[2].x and b.bounds[1].x<=a.bounds[2].x and a.bounds[1].y<=b.bounds[2].y and b.bounds[1].y<=a.bounds[2].y
end
local function validate(a)
 C.keys(a,{"id","owner","task","revision","actor","resources"})
 for _,v in ipairs({a.id,a.owner,a.task,a.actor}) do C.id(v) end;C.integer(a.revision,1,2147483647)
 C.check(type(a.resources)=="table" and #a.resources>=3 and #a.resources<=32,"incomplete_reservation_set")
 local kinds={};local ids={}
 for _,v in ipairs(a.resources) do
  C.keys(v,{"grant","resource"});C.keys(v.grant,{"id","generation"});C.id(v.grant.id);C.integer(v.grant.generation,1,2147483647)
  C.check(not ids[v.grant.id],"duplicate_reservation");ids[v.grant.id]=true
  local r=v.resource;kinds[r.kind]=true
  if r.kind=="area" then
   C.keys(r,{"kind","surface","bounds"});C.id(r.surface);C.check(type(r.bounds)=="table" and #r.bounds==2,"invalid_bounds");C.pos(r.bounds[1]);C.pos(r.bounds[2]);C.check(r.bounds[1].x<=r.bounds[2].x and r.bounds[1].y<=r.bounds[2].y,"reversed_bounds")
  else C.check(r.kind=="actor" or r.kind=="items","invalid_resource");C.keys(r,{"kind","actor"});C.check(r.actor==a.actor,"reservation_actor_mismatch") end
 end
 C.check(kinds.area and kinds.actor and kinds.items,"incomplete_reservation_set")
end
function M.control(r)
 C.keys(r,{"id","epoch","session","operation","assignment"});C.id(r.id)
 C.check(r.epoch==storage.af.epoch and r.session==storage.af.session,"stale_epoch_or_session")
 local s=state();local old=s.requests[r.id]
 if old then C.check(C.same(old.request,r),"control_id_conflict");return old end
 C.check(r.operation=="grant" or r.operation=="revoke","invalid_ownership_operation");validate(r.assignment)
 local a=r.assignment;local task=s.tasks[a.task]
 if r.operation=="grant" then
  C.check(not s.assignments[a.id],"assignment_id_used")
  C.check(not task or (not task.active and a.revision>task.revision),"stale_task_revision")
 else
  local installed=s.assignments[a.id]
  C.check(not installed or (installed.active and installed.assignment.task==a.task and installed.assignment.revision==a.revision),"unknown_revoke_assignment")
  if installed then
  local original=installed.assignment
  C.check(original.owner==a.owner and original.actor==a.actor and #original.resources==#a.resources,"revoke_scope_mismatch")
  for i,v in ipairs(a.resources) do local p=original.resources[i];C.check(C.same(p.resource,v.resource) and p.grant.id==v.grant.id and v.grant.generation==p.grant.generation+1,"revoke_scope_mismatch") end
  else C.check(not task or (not task.active and task.revision<a.revision),"stale_task_revision") end
 end
 -- Validate the complete set before changing any generation.
 for _,v in ipairs(a.resources) do
  local existing=s.grants[v.grant.id]
  C.check(not existing or (C.same(existing.resource,v.resource) and v.grant.generation>existing.generation),"stale_reservation_generation")
  if r.operation=="revoke" then C.check(not existing or not existing.active or existing.assignment==a.id,"revoke_scope_mismatch") end
  if r.operation=="grant" then for _,g in pairs(s.grants) do C.check(not g.active or not overlap(g.resource,v.resource),"reservation_conflict") end end
 end
 for _,v in ipairs(a.resources) do s.grants[v.grant.id]={generation=v.grant.generation,resource=v.resource,assignment=a.id,active=r.operation=="grant"} end
 s.tasks[a.task]={revision=a.revision,assignment=a.id,active=r.operation=="grant"}
 s.assignments[a.id]={assignment=a,active=r.operation=="grant"}
 local receipts={}
 if r.operation=="revoke" then
  local orders={};for _,o in pairs(storage.af.orders) do if o.batch.task==a.task and o.batch.revision==a.revision then orders[#orders+1]=o end end
  table.sort(orders,function(x,y)return x.commandId<y.commandId end)
  for _,o in ipairs(orders) do
   if o.status=="accepted" or o.status=="running" or o.status=="suspended" then done(o,"cancelled","ownership_revoked");o.pending=nil end
   receipts[#receipts+1]=receipt(o)
  end
 end
 local ack={request=r,tick=game.tick,receipts=receipts};s.requests[r.id]=ack;return ack
end
local function inside(p,r,surface)
 return r.kind=="area" and r.surface==surface and p.x>=r.bounds[1].x and p.x<=r.bounds[2].x and p.y>=r.bounds[1].y and p.y<=r.bounds[2].y
end
function M.box(b,box)
 local s=state();local task=s.tasks[b.task];local a=task and s.assignments[task.assignment]
 C.check(a and a.active,"stale_task_revision")
 for _,v in ipairs(a.assignment.resources) do
  if inside(box.left_top,v.resource,b.surface) and inside(box.right_bottom,v.resource,b.surface) then return end
 end
 error("effect_outside_reserved_area",0)
end
function M.movement(b,p,position,padding)
 local box=p.character.prototype.collision_box
 M.box(b,{left_top={x=position.x+box.left_top.x-padding,y=position.y+box.left_top.y-padding},right_bottom={x=position.x+box.right_bottom.x+padding,y=position.y+box.right_bottom.y+padding}})
end
function M.authority(b)
 C.check(b.epoch==storage.af.epoch and b.session==storage.af.session,"stale_epoch_or_session")
 local s=state();local task=s.tasks[b.task]
 C.check(task and task.active and task.revision==b.revision,"stale_task_revision")
 local entry=s.assignments[task.assignment];local a=entry and entry.assignment
 C.check(entry and entry.active and a.actor==b.actor and #a.resources==#b.grants,"incomplete_reservation_set")
 local areas={};local seen={}
 for _,g in ipairs(b.grants) do
  C.keys(g,{"id","generation"});C.check(not seen[g.id],"duplicate_reservation");seen[g.id]=true
  local installed=s.grants[g.id]
  C.check(installed and installed.active and installed.assignment==a.id and installed.generation==g.generation,"stale_reservation_generation")
  if installed.resource.kind=="area" then areas[#areas+1]=installed.resource end
 end
 for _,v in ipairs(a.resources) do C.check(seen[v.grant.id],"incomplete_reservation_set") end
 local p=C.actor(b.actor);C.check(p.surface.name==b.surface,"actor_surface_changed")
 M.box(b,p.character.bounding_box)
 local function covered(pos) for _,r in ipairs(areas) do if inside(pos,r,b.surface) then return true end end;return false end
 C.check(covered(p.position),"actor_outside_reserved_area")
 for _,step in ipairs(b.steps) do local pos=step.position or (step.target and step.target.position);if pos then C.check(covered(pos),"effect_outside_reserved_area") end end
 return p
end
function M.reset() M.init() end
return M
