-- Candidate-local gross flows. Shared ordinary instrumentation uses the same
-- completed-craft counters and 0.001 fluid rounding bound (operational.lua).
local C=require('common')
local Fuel=require('workshop_chain_fuel')
local M={}
-- Lua locals reset on save/load. Restored active windows require new evidence;
-- persisted craft counters cannot make a discontinuous interval current.
local admitted={}
function M.restored(chain) return not admitted[chain] end
local function identity(entities)
 local out={};for _,e in ipairs(entities) do out[#out+1]={unit=e.unit_number,name=e.name,position=e.position,direction=e.direction,quality=e.quality.name} end
 return helpers.table_to_json(out)
end
function M.rational(value)
 C.check(type(value)=='number' and value==value and math.abs(value)<9000000000,'invalid_chain_measurement_number')
 return {numerator=string.format('%.0f',value*1000000),denominator='1000000'}
end
local function recipe_ok(e,stage)
 local recipe,quality=e.get_recipe()
 local modules=e.get_module_inventory()
 if e.name~=stage.machine or e.quality.name~='normal' or quality and quality.name~='normal' or e.productivity_bonus~=0 or e.speed_bonus~=0 or e.consumption_bonus~=0 or modules and not modules.is_empty() then return false end
 -- Idle furnaces clear get_recipe(). The host pins each unit's blueprint hint;
 -- every operating tick must match it, and counter resets are checked separately.
 return recipe and recipe.name==stage.recipe or e.type=='furnace' and not recipe
end
function M.configure(w,chain,entities,fingerprint,stock,ports)
 C.keys(chain,{'boundaryFingerprint','candidateFingerprint','stages'})
 C.check(chain.boundaryFingerprint==w.boundaryFingerprint and chain.candidateFingerprint==fingerprint,'chain_measurement_boundary_changed')
 C.check(type(chain.stages)=='table' and #chain.stages>0 and #chain.stages<=64,'incomplete_chain_manifest')
 local by_unit={};for _,e in ipairs(entities) do by_unit[e.unit_number]=e end
 local ids,used={},{}
 for _,stage in ipairs(chain.stages) do
  C.keys(stage,stage.fuel and {'id','recipe','machine','units','fuel'} or {'id','recipe','machine','units'});C.id(stage.id);C.id(stage.recipe);C.id(stage.machine)
  C.check(not ids[stage.id] and #stage.units>0,'incomplete_chain_stage');ids[stage.id]=true
  local recipe=prototypes.recipe[stage.recipe]
  C.check(recipe and game.forces[w.force].recipes[stage.recipe].enabled,'chain_recipe_unavailable')
  for _,rows in ipairs({recipe.ingredients,recipe.products}) do for _,p in pairs(rows) do
   C.check(p.amount and (not p.probability or p.probability==1) and not p.amount_min and not p.amount_max and (p.extra_count_fraction or 0)==0 and (p.percent_spoiled or 0)==0,'chain_recipe_unsupported')
  end end
  for _,unit in ipairs(stage.units) do
   C.integer(unit,1,9007199254740991);local e=by_unit[unit]
   C.check(e and not used[unit] and (e.type=='assembling-machine' or e.type=='furnace') and e.prototype.crafting_categories[recipe.category] and recipe_ok(e,stage),'chain_machine_binding_invalid')
   C.check(e.products_finished==0 and e.crafting_progress==0,'chain_candidate_previously_operated');used[unit]=true
  end
 end
 for _,e in ipairs(entities) do if e.type=='assembling-machine' or e.type=='furnace' then C.check(used[e.unit_number],'chain_unbound_machine') end end
 -- Candidate process stock starts empty. Fixture source stock is excluded by
 -- the caller; settling may then fill real buffers through declared supplies.
 for _,amount in pairs(stock) do C.check(amount<=0.001,'chain_candidate_preload') end
 local sinks={};for _,port in ipairs(ports) do sinks[port.fixtureId]=true end
 for id,fixture in pairs(w.fixtures) do C.check(fixture.bounded==true,'chain_unbounded_fixture');if fixture.kind=='sink' then C.check(sinks[id],'chain_sink_coverage_missing') end end
 local bound={stages=chain.stages,fuel=Fuel.configure(w,chain.stages,by_unit),fingerprint=identity(entities),epoch=storage.af.epoch};admitted[bound]=true;return bound
end
function M.snapshot(chain,entities)
 local out={valid=admitted[chain] and not chain.invalid and identity(entities)==chain.fingerprint and storage.af.epoch==chain.epoch,counts={},started={}}
 local by_unit={};for _,e in ipairs(entities) do by_unit[e.unit_number]=e end
 for _,stage in ipairs(chain.stages) do for _,unit in ipairs(stage.units) do
  local e=by_unit[unit]
  if not e or not recipe_ok(e,stage) or type(e.products_finished)~='number' then out.valid=false else
   out.counts[unit]=e.products_finished;out.started[unit]=e.products_finished+(e.crafting_progress>0 and 1 or 0)
   if chain.lastCounts and chain.lastCounts[unit] and e.products_finished<chain.lastCounts[unit] or chain.lastStarted and chain.lastStarted[unit] and out.started[unit]<chain.lastStarted[unit] then out.valid=false end
  end
 end end
 out.fuel=Fuel.snapshot(chain.fuel,by_unit);out.energyValid=out.fuel.valid
 if not out.fuel.valid then out.valid=false end
 chain.lastCounts=out.counts;chain.lastStarted=out.started;if not out.valid then chain.invalid=true end
 return out
end
function M.flow(chain,before,after,kind,name,direction)
 local total=0
 for _,stage in ipairs(chain.stages) do for _,p in pairs(direction=='inputs' and prototypes.recipe[stage.recipe].ingredients or prototypes.recipe[stage.recipe].products) do if p.type==kind and p.name==name then
  for _,unit in ipairs(stage.units) do local a=direction=='inputs' and before.started[unit] or before.counts[unit];local b=direction=='inputs' and after.started[unit] or after.counts[unit];if a and b and b>=a then total=total+(b-a)*p.amount end end
 end end end
 if direction=='inputs' and kind=='item' then for _,stage in ipairs(chain.stages) do total=total+Fuel.amount(chain.fuel,before.fuel,after.fuel,stage.units,name) end end
 return total
end
function M.window(chain,before,after,attempt,index)
 local out={};local complete=before and after and before.valid and after.valid
 for _,stage in ipairs(chain.stages) do
  local crafts=0;local valid=complete
  for _,unit in ipairs(stage.units) do local a=before and before.counts[unit];local b=after and after.counts[unit];if not a or not b or b<a then valid=false else crafts=crafts+b-a end end
  local recipe=prototypes.recipe[stage.recipe];local row={id=stage.id,recipe=stage.recipe,machine=stage.machine,crafts=M.rational(crafts),coverage=valid and 'complete' or 'unknown',inputs={},outputs={},evidence={'workshop-chain:'..attempt..':'..index..':'..stage.id}}
  local fuel_amount=Fuel.amount(chain.fuel,before and before.fuel,after and after.fuel,stage.units)
  local fuel_error=Fuel.error(chain.fuel,before and before.fuel,after and after.fuel,stage.units);local merged=false
  for _,direction in ipairs({'inputs','outputs'}) do for _,p in pairs(direction=='inputs' and recipe.ingredients or recipe.products) do
   local error_bound=(direction=='inputs' and p.amount*#stage.units or 0)+(p.type=='fluid' and 0.002*#stage.units or 0)
   local amount=crafts*p.amount
   if direction=='inputs' and p.type=='item' and p.name==stage.fuel then amount=amount+fuel_amount;error_bound=error_bound+fuel_error;merged=true end
   row[direction][#row[direction]+1]={kind=p.type,name=p.name,amount=M.rational(amount),error=M.rational(error_bound)}
  end end
  if stage.fuel and not merged then row.inputs[#row.inputs+1]={kind='item',name=stage.fuel,amount=M.rational(fuel_amount),error=M.rational(fuel_error)} end
  out[#out+1]=row
 end
 return out,complete
end
return M
