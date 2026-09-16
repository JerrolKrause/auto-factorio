-- Operator-only event evidence. Ambiguous overlap is never attributed to a human with certainty.
local E={}
local V=require('verification')
function E.record(event,kind)
 if not storage.af then return end
 local entity=event.entity or event.created_entity or event.destination
 local active=storage.af.active['builder-'..tostring(event.player_index)]
 local order=active and storage.af.orders[active]
 local step=order and order.batch.steps[order.completed+1]
 -- Building/rotation callbacks run inside A.tick. Timed mining finishes between ticks,
 -- so match the controlled mining target instead. Unmatched overlap stays unknown.
 if active and storage.af.executing==active and ((kind=='build' and step.kind=='place') or (kind=='rotate' and step.kind=='rotate')) then return end
 if kind=='mine' and step and step.kind=='mine' and entity and entity.valid then
  local target=step.target
  if entity.name==target.name and entity.surface.name==order.batch.surface and entity.position.x==target.position.x and entity.position.y==target.position.y then return end
 end
 storage.af.edits=storage.af.edits or {sequence=0,events={},overflow=false}
 V.invalidate('human_or_uncertain_edit:'..kind)
 local log=storage.af.edits
 if #log.events>=2000 then log.overflow=true;return end
 log.sequence=log.sequence+1
 local detail={kind=kind,player=event.player_index}
 if entity and entity.valid then detail.entity={name=entity.name,surface=entity.surface.name,position=entity.position} end
 log.events[#log.events+1]={id=storage.af.session..'-edit-'..log.sequence,sequence=log.sequence,gameTick=game.tick,detail=detail,causality=active and 'unknown' or 'human'}
end
function E.read(after)
 local log=storage.af.edits or {sequence=0,events={},overflow=false};local events={}
 for _,event in ipairs(log.events) do if event.sequence>after and #events<100 then events[#events+1]=event end end
 return {ok=true,events=events,overflow=log.overflow,sequence=log.sequence,coverage='player build, mine, rotate, settings paste, tile build/mine; script and arbitrary inventory changes not fully covered'}
end
return E
