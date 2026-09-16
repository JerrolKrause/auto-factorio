-- Scenario setup is privileged; production cells are always built by character actions.
local C=require('common')
local S={}
local kit={['assembling-machine-1']=12,['transport-belt']=300,inserter=60,['long-handed-inserter']=12,['underground-belt']=12,splitter=6,['small-electric-pole']=24,['wooden-chest']=8}
local actions={'walk','place','rotate','mine','recipe','transfer'}
local function protect(e)
 C.check(e,'scenario_fixture_collision');storage.af.protected[e.unit_number]=true
 e.minable=false;e.destructible=false;e.rotatable=false;return e
end
function S.player(p)
 local s=storage.af.scenario;if not s then return false end
 p.teleport({0,10},'nauvis');p.get_main_inventory().clear()
 for name,count in pairs(kit) do C.check(p.insert{name=name,count=count,quality='normal'}==count,'kit_inventory_capacity') end
 p.print('First Shift: automate 30 red science/minute for five minutes. Gear/copper terminals supply 60/minute each; connect automatic output to the labeled collector. Finite kit; normal character rules.')
 return true
end
function S.guard(step)
 if not storage.af.scenario then return end
 C.check(step.kind~='craft','scenario_crafting_disabled')
 if step.kind=='place' then C.check(kit[step.item] and step.quality=='normal','scenario_equipment_not_allowed') end
 if step.kind=='recipe' then C.check(step.recipe=='automation-science-pack','scenario_recipe_not_allowed') end
end
function S.rpc(r)
 C.keys(r,{'op','action'})
 if r.action=='inspect' then C.check(storage.af.scenario,'scenario_not_configured');return {ok=true,manifest=storage.af.scenario.manifest} end
 C.check(r.action=='setup','unsupported_scenario_action')
 local c=storage.af.control
 C.check(not c.armed and game.tick_paused and not c.ready and next(storage.af.orders)==nil and not storage.af.scenario and not storage.af.verification,'scenario_requires_fresh_disarmed_pause')
 local surface=game.surfaces.nauvis;local force=game.forces.player
 for _,e in pairs(surface.find_entities_filtered{area={{-32,-32},{32,32}}}) do if e.type~='character' then e.destroy() end end
 storage.af.protected={}
 local tiles={};for x=-32,31 do for y=-32,31 do tiles[#tiles+1]={name='grass-1',position={x,y}} end end;surface.set_tiles(tiles)
 for _,t in pairs(force.technologies) do t.researched=false end
 force.reset_technology_effects()
 local grants={'automation','logistics','electronics','automation-science-pack'}
 for _,name in ipairs(grants) do C.check(force.technologies[name],'scenario_technology_missing:'..name);force.technologies[name].researched=true end
 local actual={};for name,t in pairs(force.technologies) do if t.researched then actual[#actual+1]=name end end;table.sort(actual)
 local function create(name,x,y,direction) return protect(surface.create_entity{name=name,position={x,y},direction=direction or 0,force=force,quality='normal'}) end
 local gears=create('transport-belt',-21.5,-2.5,defines.direction.east)
 local copper=create('transport-belt',-21.5,3.5,defines.direction.east)
 local collector=create('steel-chest',23.5,-5.5)
 local power=create('electric-energy-interface',-25,0);power.power_production=10000000;power.electric_buffer_size=100000000;power.energy=100000000
 create('substation',-22,0)
 for _,v in ipairs({{gears,'Gears: 60/min'},{copper,'Copper: 60/min'},{collector,'Automatic science collector'}}) do rendering.draw_text{text=v[2],surface=surface,target={v[1].position.x,v[1].position.y-1},color={1,1,1},alignment='center',scale=0.8} end
 force.chart(surface,{{-32,-32},{32,32}})
 local recipe=force.recipes['automation-science-pack']
 storage.af.scenario={origin=game.tick,terminals={['iron-gear-wheel']=gears,['copper-plate']=copper},collector=collector,injected={['iron-gear-wheel']=0,['copper-plate']=0},collected=0,
  manifest={id='01-first-shift',version='s1-v1',seed=surface.map_gen_settings.seed,mods=script.active_mods,surface='nauvis',quality='normal',area={{-32,-32},{32,32}},grants=actual,kit=kit,allowedActions=actions,allowedRecipes={'automation-science-pack'},rates={['iron-gear-wheel']=60,['copper-plate']=60},terminals={gears=C.ref(gears),copper=C.ref(copper)},collector=C.ref(collector),settlingTicks=600,windowTicks=3600,windows=5,target=30,gameLimitTicks=108000,wallLimitMs=5400000,evaluator='s1-measurement-v1',recipe={name=recipe.name,energy=recipe.energy,ingredients=recipe.ingredients,products=recipe.products},assemblerSpeed=prototypes.entity['assembling-machine-1'].get_crafting_speed('normal')}}
 for _,p in pairs(game.players) do S.player(p) end
 return {ok=true,manifest=storage.af.scenario.manifest}
end
function S.tick()
 local s=storage.af.scenario;if not s or not storage.af.control.armed then return end
 if (game.tick-s.origin)%60==0 then
  for item,e in pairs(s.terminals) do
   C.check(e.valid,'scenario_terminal_missing')
   -- Blocked terminals discard the scheduled supply rather than banking a later burst.
   if e.get_transport_line(1).insert_at_back{name=item,count=1,quality='normal'} then s.injected[item]=s.injected[item]+1 end
  end
 end
 local inv=s.collector.get_inventory(defines.inventory.chest)
 s.collected=s.collected+inv.remove{name='automation-science-pack',quality='normal',count=1000000}
end
return S
