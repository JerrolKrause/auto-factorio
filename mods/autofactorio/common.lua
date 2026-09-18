local M = {}
function M.check(ok, reason) if not ok then error(reason, 0) end end
function M.keys(t, names)
  M.check(type(t)=="table", "invalid_object")
  local allowed={}; for _,k in ipairs(names) do allowed[k]=true; M.check(t[k]~=nil, "missing_"..k) end
  for k in pairs(t) do M.check(allowed[k], "unexpected_field_"..tostring(k)) end
end
function M.id(s) M.check(type(s)=="string" and #s>0 and #s<=100 and s:match("^[%w_.-]+$"), "invalid_identifier") end
function M.integer(n, lo, hi) M.check(type(n)=="number" and n==math.floor(n) and n>=lo and n<=hi, "invalid_integer") end
-- Coordinates are bounded for payload safety; the active ownership grant remains
-- the authority for the much smaller scenario-specific playable area.
function M.pos(p) M.keys(p,{"x","y"}); for _,n in pairs(p) do M.check(type(n)=="number" and n==n and math.abs(n)<=4096,"outside_assignment") end end
function M.distance(a,b) return math.sqrt((a.x-b.x)^2+(a.y-b.y)^2) end
function M.inventory(inv)
  local items={}; if not inv then return items end
  for _,i in pairs(inv.get_contents()) do items[#items+1]={name=i.name,quality=i.quality,count=i.count} end
  table.sort(items,function(a,b) return a.name..a.quality<b.name..b.quality end); return items
end
function M.delta(before,after)
  local counts={}; for _,list in ipairs({{before,-1},{after,1}}) do for _,i in pairs(list[1]) do local k=i.name..":"..i.quality; counts[k]=counts[k] or {name=i.name,quality=i.quality,count=0}; counts[k].count=counts[k].count+i.count*list[2] end end
  local out={};for _,i in pairs(counts) do if i.count~=0 then out[#out+1]=i end end; table.sort(out,function(a,b)return a.name..a.quality<b.name..b.quality end);return out
end
function M.target(t)
  M.check(type(t)=="table","invalid_target"); local allowed={name=true,quality=true,position=true,unit=true};for k in pairs(t) do M.check(allowed[k],"unexpected_target_field") end
  M.id(t.name);M.id(t.quality);M.pos(t.position);if t.unit then M.integer(t.unit,1,2147483647) end
end
function M.find(surface,t)
  for _,e in pairs(surface.find_entities_filtered{position=t.position,name=t.name}) do
    if e.valid and e.quality.name==t.quality and (e.unit_number or false)==(t.unit or false) and M.distance(e.position,t.position)<0.01 then return e end
  end
  error("entity_precondition_failed",0)
end
function M.protected(e) return storage.af.protected[e.unit_number or (e.name..":"..e.position.x..":"..e.position.y)]==true end
function M.ref(e) return {name=e.name,quality=e.quality.name,position=e.position,unit=e.unit_number} end
M.inventory_ids={chest=defines.inventory.chest,input=defines.inventory.assembling_machine_input,output=defines.inventory.assembling_machine_output,fuel=defines.inventory.fuel}
function M.entity_inventory(e,name)
 if (e.type=="container" or e.type=="logistic-container") and name=="chest" then return e.get_inventory(defines.inventory.chest) end
 if e.type=="assembling-machine" and (name=="input" or name=="output") then return e.get_inventory(M.inventory_ids[name]) end
 if e.type=="furnace" then
  if name=="input" then return e.get_inventory(defines.inventory.furnace_source) end
  if name=="output" then return e.get_inventory(defines.inventory.furnace_result) end
  if name=="fuel" then return e.get_inventory(defines.inventory.fuel) end
 end
 return nil
end
function M.actor(id)
 local index=storage.af.actors[id];local p=index and game.get_player(index)
 M.check(p and p.valid and p.connected and p.character and p.character.valid and not p.driving,"actor_unavailable");return p
end
function M.same(a,b)
 if type(a)~=type(b) then return false end
 if type(a)~="table" then return a==b end
 for k,v in pairs(a) do if not M.same(v,b[k]) then return false end end
 for k in pairs(b) do if a[k]==nil then return false end end
 return true
end
return M
