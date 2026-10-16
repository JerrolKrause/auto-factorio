-- Native burner accounting, in equivalent items of the pinned fuel. Observe
-- remaining fuel plus stored heat: inventory removal alone counts a whole
-- item at ignition and would misstate consumption across a window boundary.
local C=require('common')
local M={}
local EPS=0.01 -- joules; bounded per-tick tolerance, propagated into flow error
local function number(value) return type(value)=='number' and value==value and value>=0 and value<9000000000 end
local function read(e,name)
 if not e or not e.valid or not e.burner or not e.burner.valid then return nil end
 local b=e.burner;local remaining,heat=b.remaining_burning_fuel,b.heat
 if not number(remaining) or not number(heat) or heat>b.heat_capacity+EPS then return nil end
 local burning=b.currently_burning
 -- Factorio 2.0 reads ItemIDAndQualityIDPair: name and quality are
 -- prototypes, not strings (the write side also accepts simpler item IDs).
 if burning and (burning.name.name~=name or burning.quality.name~='normal') or remaining>EPS and not burning then return nil end
 for _,item in ipairs(C.inventory(b.inventory)) do if item.name~=name or item.quality~='normal' then return nil end end
 return remaining+heat
end
function M.configure(w,stages,by_unit)
 local state={units={},invalid=false}
 for _,stage in ipairs(stages) do for _,unit in ipairs(stage.units) do
  local e=by_unit[unit];local burner=e and e.prototype.burner_prototype
  C.check((burner~=nil)==(stage.fuel~=nil),'chain_selected_fuel_missing_or_unexpected')
  if burner then
   C.id(stage.fuel);local fuel=prototypes.item[stage.fuel];local supplied=false
   for _,fixture in pairs(w.fixtures) do if fixture.kind=='source' and fixture.product.kind=='item' and fixture.product.name==stage.fuel then supplied=true end end
   local maximum=e.prototype.get_max_energy_usage('normal')
   -- One refill per tick must be identifiable from an energy rise. Other
   -- effectivities, residues or tiny fuel values need a different calibration.
   C.check(supplied and fuel and fuel.fuel_value>0 and fuel.fuel_value<9000000000 and not fuel.burnt_result and burner.effectivity==1 and burner.fuel_categories[fuel.fuel_category] and maximum>0 and fuel.fuel_value>e.burner.heat_capacity+maximum,'chain_fuel_unsupported')
   local energy=read(e,stage.fuel)
   C.check(energy and energy<=EPS,'chain_burner_preload_or_invalid_fuel')
   state.units[unit]={name=stage.fuel,value=fuel.fuel_value,maximum=maximum,energy=energy,consumed=0,loads=0,tick=game.tick}
  end
 end end
 return state
end
function M.snapshot(state,by_unit)
 local out={valid=not state.invalid,tick=game.tick,consumed={},loads={},energy={},stock={}}
 for unit,row in pairs(state.units) do
  local energy=read(by_unit[unit],row.name)
  if not energy then out.valid=false else
   if game.tick~=row.tick then
    if game.tick~=row.tick+1 then out.valid=false else
     local refill=energy>row.energy+EPS and 1 or 0
     local used=row.energy+refill*row.value-energy
     if used < -EPS or used > row.maximum+EPS then out.valid=false else
      row.consumed=row.consumed+math.max(0,used)/row.value;row.loads=row.loads+refill
     end
    end
    row.tick=game.tick;row.energy=energy
   elseif math.abs(energy-row.energy)>EPS then out.valid=false end
   out.energy[unit]=energy;out.stock[row.name]=(out.stock[row.name] or 0)+energy/row.value
  end
  out.consumed[unit]=row.consumed;out.loads[unit]=row.loads
 end
 if not out.valid then state.invalid=true end
 return out
end
function M.amount(state,before,after,units,name)
 local total=0
 for _,unit in ipairs(units) do local row=state.units[unit]
  if row and (not name or row.name==name) then
   local a=before and before.consumed[unit];local b=after and after.consumed[unit]
   if a and b and b>=a then total=total+b-a end
  end
 end
 return total
end
function M.error(state,before,after,units)
 local ticks=before and after and math.max(0,after.tick-before.tick) or 0;local error=0
 for _,unit in ipairs(units) do local row=state.units[unit];if row then error=error+EPS*ticks/row.value+0.000001 end end
 -- Round the bound upward to the measurement's millionth-item quantum.
 return math.ceil(error*1000000)/1000000
end
return M
