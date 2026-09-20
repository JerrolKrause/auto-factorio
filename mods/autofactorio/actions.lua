local C=require("common")
local F=require("ownership")
local M={}
function M.validate(s)
 C.check(type(s)=="table","invalid_step")
 if s.kind=="walk" then C.keys(s,{"kind","position"});C.pos(s.position)
 elseif s.kind=="place" then C.keys(s,{"kind","position","item","quality","direction"});C.pos(s.position);C.id(s.item);C.id(s.quality);C.integer(s.direction,0,15)
 elseif s.kind=="rotate" or s.kind=="mine" then C.keys(s,{"kind","target"});C.target(s.target)
 elseif s.kind=="recipe" then C.keys(s,{"kind","target","recipe"});C.target(s.target);C.id(s.recipe)
 elseif s.kind=="craft" then C.keys(s,{"kind","recipe","count"});C.id(s.recipe);C.integer(s.count,1,100)
 elseif s.kind=="transfer" then C.keys(s,{"kind","target","inventory","flow","item"});C.target(s.target);C.check(C.inventory_ids[s.inventory] and (s.flow=="put" or s.flow=="take"),"unsupported_transfer");C.keys(s.item,{"name","quality","count"});C.id(s.item.name);C.id(s.item.quality);C.integer(s.item.count,1,1000)
 elseif s.kind=="module" then C.keys(s,{"kind","target","item"});C.target(s.target);C.keys(s.item,{"name","quality","count"});C.id(s.item.name);C.id(s.item.quality);C.integer(s.item.count,1,1000)
 elseif s.kind=="filter" then C.keys(s,{"kind","target","slot","item"});C.target(s.target);C.integer(s.slot,1,100);if s.item then C.keys(s.item,{"name","quality"});C.id(s.item.name);C.id(s.item.quality) end
 elseif s.kind=="bar" then C.keys(s,{"kind","target","inventory","limit"});C.target(s.target);C.check(s.inventory=="chest","unsupported_inventory_bar");if s.limit then C.integer(s.limit,1,1000) end
 elseif s.kind=="wire" then C.keys(s,{"kind","target","other","fromConnector","toConnector"});C.target(s.target);C.target(s.other);C.integer(s.fromConnector,0,255);C.integer(s.toConnector,0,255)
 elseif s.kind=="setting" then C.keys(s,{"kind","target","name","value"});C.target(s.target);C.check(s.name=="active" or s.name=="inserter_filter_mode" or s.name=="splitter_input_priority" or s.name=="splitter_output_priority" or s.name=="underground_type","unsupported_entity_setting");C.check(type(s.value)=="string" or type(s.value)=="boolean","invalid_entity_setting")
 else error("unsupported_action",0) end
end
function M.neutral(p,craft)
 p.walking_state={walking=false};p.mining_state={mining=false}
 if craft and p.crafting_queue then while p.crafting_queue and #p.crafting_queue>0 do local q=p.crafting_queue[1];p.cancel_crafting{index=1,count=q.count} end end
end
local function entity(p,s)
 local e=C.find(p.surface,s.target); C.check(not C.protected(e),"protected_fixture");C.check(e.force==p.force or e.type=="resource","unrelated_structure");C.check(C.distance(p.position,e.position)<=p.reach_distance and p.can_reach_entity(e),"out_of_reach");return e
end
local function move(p,o,s)
 local w=o.work
 if C.distance(p.position,s.position)<=0.2 then M.neutral(p,false);return true end
 if not w.request then
   w.request=p.surface.request_path{bounding_box=p.character.prototype.collision_box,collision_mask=p.character.prototype.collision_mask,start=p.position,goal=s.position,force=p.force,radius=0.2,entity_to_ignore=p.character,can_open_gates=true,pathfind_flags={cache=false}}
   storage.af.paths[w.request]=o.commandId;w.last=p.position;w.check=game.tick;return false
 end
 C.check(not w.pathFailed,"path_unreachable")
 if not w.path then C.check(game.tick-w.startedTick<300,"path_timeout");return false end
 while w.waypoint<=#w.path and C.distance(p.position,w.path[w.waypoint])<0.2 do w.waypoint=w.waypoint+1 end
 local goal=w.path[w.waypoint] or s.position; C.pos(goal)
 -- Engine movement happens between Lua ticks. Reserve the entire possible next-tick sweep.
 F.movement(o.batch,p,p.position,p.character_running_speed+1/256)
 F.movement(o.batch,p,goal,0)
 if game.tick-w.check>=60 then C.check(C.distance(p.position,w.last)>0.02,"movement_blocked");w.last=p.position;w.check=game.tick end
 local angle=math.atan2(goal.y-p.position.y,goal.x-p.position.x);local direction=(math.floor(angle/(math.pi/4)+0.5)*2+4)%16
 p.walking_state={walking=true,direction=direction};return false
end
function M.tick(p,o,s)
 local w=o.work
 if s.kind=="walk" then return move(p,o,s)
 elseif s.kind=="place" then
  C.check(s.quality=="normal","unsupported_quality_placement");local proto=prototypes.item[s.item];C.check(proto and proto.place_result,"not_placeable")
  C.check(C.distance(p.position,s.position)<=p.build_distance,"out_of_reach")
  C.check(not p.cursor_stack.valid_for_read,"cursor_busy");local inv=p.get_main_inventory();C.check(inv.get_item_count{name=s.item,quality=s.quality}>=1,"insufficient_inventory")
  -- Manual building permits fast replacement; this bounded action must never replace an occupant.
  local box=proto.place_result.collision_box;local radius=math.max(math.abs(box.left_top.x),math.abs(box.left_top.y),math.abs(box.right_bottom.x),math.abs(box.right_bottom.y))
  F.box(o.batch,{left_top={x=s.position.x-radius,y=s.position.y-radius},right_bottom={x=s.position.x+radius,y=s.position.y+radius}})
  for _,e in pairs(p.surface.find_entities_filtered{area={{s.position.x-radius,s.position.y-radius},{s.position.x+radius,s.position.y+radius}}}) do
   C.check(e.type=="resource" or e.type=="item-entity", "occupied_or_collision")
  end
  C.check(p.surface.can_place_entity{name=proto.place_result.name,position=s.position,direction=s.direction,force=p.force,build_check_type=defines.build_check_type.manual},"occupied_or_collision")
  local taken=inv.remove{name=s.item,quality=s.quality,count=1};C.check(taken==1,"inventory_changed");p.cursor_stack.set_stack{name=s.item,quality=s.quality,count=1}
  local ok,err=pcall(function() C.check(p.can_build_from_cursor{position=s.position,direction=s.direction},"cannot_build");p.build_from_cursor{position=s.position,direction=s.direction} end)
  local leftover=p.cursor_stack.valid_for_read and p.cursor_stack.count or 0
  if leftover>0 then local returned=inv.insert(p.cursor_stack);C.check(returned==leftover,"cursor_refund_failed");p.cursor_stack.clear() end
  C.check(ok,tostring(err));C.check(p.surface.find_entity(proto.place_result.name,s.position),"build_failed");return true
 elseif s.kind=="craft" then
  if not w.begun then C.check(not p.crafting_queue or #p.crafting_queue==0,"crafting_busy");local recipe=p.force.recipes[s.recipe];C.check(recipe and recipe.enabled,"recipe_unavailable");local count=p.begin_crafting{count=s.count,recipe=s.recipe,silent=true};w.begun=true;C.check(count==s.count,"insufficient_crafting_materials");return false end
  return not p.crafting_queue or #p.crafting_queue==0
 elseif s.kind=="mine" then
  if w.mined then M.neutral(p,false);return true end
  local e=entity(p,s);F.box(o.batch,e.bounding_box);C.check(e.minable,"not_minable");p.update_selected_entity(e.position);C.check(p.selected==e,"selection_blocked");p.mining_state={mining=true,position=e.position};return false
 elseif s.kind=="rotate" then local e=entity(p,s);local box=e.prototype.collision_box;local radius=math.max(math.abs(box.left_top.x),math.abs(box.left_top.y),math.abs(box.right_bottom.x),math.abs(box.right_bottom.y));F.box(o.batch,{left_top={x=e.position.x-radius,y=e.position.y-radius},right_bottom={x=e.position.x+radius,y=e.position.y+radius}});C.check(e.rotate{by_player=p},"rotation_failed");return true
 elseif s.kind=="recipe" then
  local e=entity(p,s);C.check(e.type=="assembling-machine","not_assembler");local recipe=p.force.recipes[s.recipe];C.check(recipe and recipe.enabled,"recipe_unavailable")
  F.box(o.batch,e.bounding_box)
  local returned=e.set_recipe(s.recipe,"normal");for _,i in pairs(returned) do local n=p.insert(i);if n<i.count then p.surface.spill_item_stack{position=p.position,stack={name=i.name,quality=i.quality,count=i.count-n},enable_looted=true,force=p.force} end end
  C.check(e.get_recipe() and e.get_recipe().name==s.recipe,"recipe_failed");return true
 elseif s.kind=="transfer" then
  local e=entity(p,s);local inv=C.entity_inventory(e,s.inventory);C.check(inv,"unsupported_inventory");local main=p.get_main_inventory();local source=s.flow=="put" and main or inv;local dest=s.flow=="put" and inv or main
  F.box(o.batch,e.bounding_box)
  C.check(source.get_item_count(s.item)>=s.item.count,"insufficient_inventory");C.check(dest.get_insertable_count(s.item)>=s.item.count,"destination_full")
  local n=source.remove(s.item);local inserted=dest.insert{name=s.item.name,quality=s.item.quality,count=n};if inserted<n then C.check(source.insert{name=s.item.name,quality=s.item.quality,count=n-inserted}==n-inserted,"transfer_refund_failed") end;C.check(inserted==s.item.count,"partial_transfer");return true
 elseif s.kind=="module" then
  local e=entity(p,s);local modules=e.get_module_inventory();C.check(modules,"unsupported_module_inventory");local main=p.get_main_inventory();F.box(o.batch,e.bounding_box);C.check(main.get_item_count(s.item)>=s.item.count,"insufficient_inventory");C.check(modules.get_insertable_count(s.item)>=s.item.count,"module_inventory_full");local removed=main.remove(s.item);local inserted=modules.insert{name=s.item.name,quality=s.item.quality,count=removed};if inserted<removed then main.insert{name=s.item.name,quality=s.item.quality,count=removed-inserted} end;C.check(inserted==s.item.count,"partial_module_insert");return true
 elseif s.kind=="filter" then
  local e=entity(p,s);F.box(o.batch,e.bounding_box);C.check(s.slot<=e.filter_slot_count,"filter_slot_unavailable");e.set_filter(s.slot,s.item);local actual=e.get_filter(s.slot);C.check((not s.item and not actual) or (actual and actual.name==s.item.name and actual.quality==s.item.quality),"filter_failed");return true
 elseif s.kind=="bar" then
  local e=entity(p,s);local inv=C.entity_inventory(e,s.inventory);C.check(inv and inv.supports_bar(),"inventory_bar_unsupported");F.box(o.batch,e.bounding_box);inv.set_bar(s.limit);C.check(inv.get_bar()==s.limit,"inventory_bar_failed");return true
 elseif s.kind=="wire" then
  local e=entity(p,s);local other=C.find(p.surface,s.other);C.check(not C.protected(other) and other.force==p.force,"unrelated_structure");C.check(C.distance(p.position,other.position)<=p.reach_distance and p.can_reach_entity(other),"out_of_reach");F.box(o.batch,e.bounding_box);F.box(o.batch,other.bounding_box);local from=e.get_wire_connector(s.fromConnector,true);local target=other.get_wire_connector(s.toConnector,true);C.check(from and target and from.can_wire_reach(target),"wire_out_of_reach");C.check(from.is_connected_to(target) or from.connect_to(target,true,defines.wire_origin.player),"wire_failed");return true
 elseif s.kind=="setting" then
  local e=entity(p,s);F.box(o.batch,e.bounding_box);local key=s.name=="underground_type" and "belt_to_ground_type" or s.name;local ok=pcall(function()e[key]=s.value end);C.check(ok and e[key]==s.value,"entity_setting_failed");return true
 end
 error("unsupported_action",0)
end
return M
