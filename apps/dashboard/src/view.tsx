import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardSnapshot } from '../../runtime/dashboard-types.js';
import type { Event } from '../../../packages/core/execution/durable.js';
import { applyEvent, roleState } from './state.js';
import { WorkshopPanel } from './workshop.js';
import { MainNavigation, useNavigation } from './navigation.js';
import { RunDetail, RunHistory } from './history.js';

const json = (v: unknown) => JSON.stringify(v, null, 2);
const show = (v: unknown) => v === null || v === undefined ? 'Unknown' : String(v);
export function App() {
  const { page, runId, navigate } = useNavigation();
  const [data, setData] = useState<DashboardSnapshot>();
  const [connection, setConnection] = useState('Connecting');
  const [error, setError] = useState(''); const [detail, setDetail] = useState<unknown>();
  const [libraryDetail,setLibraryDetail]=useState<unknown>();
  const libraryScope=useRef({page});
  if(libraryScope.current.page!==page)libraryScope.current={page};
  const currentLibraryScope=libraryScope.current;
  // Result selection retires presentation only; the underlying export still completes.
  const librarySelection=useRef(0);
  function beginInspect(){const serial=++librarySelection.current;return(value:unknown)=>{if(libraryScope.current!==currentLibraryScope||librarySelection.current!==serial)return;if(page==='library')setLibraryDetail(value);else setDetail(value);};}
  useEffect(()=>setLibraryDetail(undefined),[page]);
  const [recipient, setRecipient] = useState('engineer'); const [advice, setAdvice] = useState('');
  const [pending, setPending] = useState(false); const adviceId = useRef(crypto.randomUUID());
  const [history, setHistory] = useState<Event[]>([]); const historyCursor = useRef(0);
  const [owner, setOwner] = useState<{id:string;kind:'workshop'|'scenario';state:string;reason:string|null}|null>(null);
  const lastOwner = useRef<typeof owner>(null);
  const announcedRuns = useRef(new Set<string>());
  const [completionFeedback,setCompletionFeedback]=useState('');
  const [stopFeedback, setStopFeedback] = useState('');
  const [stopping, setStopping] = useState(false);
  const api = useCallback(async (route: string, body?: unknown) => {
    const response = await fetch('/api/' + route, { headers: { ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: json(body) } : {}) });
    const value: unknown = await response.json();
    if (!response.ok) throw new Error(show((value as { error?: string }).error)); return value;
  }, []);
  useEffect(() => {
    let closed = false; const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const connect = async () => {
      try {
        const initial = await api('snapshot') as DashboardSnapshot;
        if (closed) return; setData(initial); setConnection('Live');
        const response = await fetch('/api/events?after=' + initial.cursor, { signal: abort.signal });
        if (!response.ok || !response.body) throw new Error('Event stream unavailable');
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
        while (!closed) {
          const chunk = await reader.read(); if (chunk.done) throw new Error('Event stream closed');
          buffer += decoder.decode(chunk.value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const line = frame.split('\n').find(l => l.startsWith('data: '));
            if (line) { const event = JSON.parse(line.slice(6)) as Event; setData(prior => prior ? applyEvent(prior, event) : prior); }
          }
        }
      } catch (e) { if (!closed) { setConnection('Disconnected · reconnecting'); setError(String(e)); timer = setTimeout(() => void connect(), 1500); } }
    };
    void connect(); return () => { closed = true; abort.abort(); clearTimeout(timer); };
  }, []);
  useEffect(() => { let closed=false; const refresh=()=>void api('workspace/owner').then(raw=>{if(closed)return;const next=(raw as {owner:typeof owner}).owner,previous=lastOwner.current;lastOwner.current=next;setOwner(next);
      if(previous&&previous.id!==next?.id&&!announcedRuns.current.has(previous.id)){
        announcedRuns.current.add(previous.id);
        void api(`workspace/requests/${encodeURIComponent(previous.id)}`).then(value=>{if(closed)return;const request=(value as {request:{state:string;reason:string|null}}).request;
          if(['completed','cancelled','failed'].includes(request.state))setCompletionFeedback(`${previous.kind==='workshop'?'Workshop':'Scenario'} ${previous.id} ${request.state}${request.reason?` · ${request.reason}`:''}. Open Run History for evidence.`);
        }).catch(()=>{});
      }
    }).catch(()=>{});
    refresh();const timer=setInterval(refresh,2000);return()=>{closed=true;clearInterval(timer);}; },[api]);
  useEffect(() => {
    if(!data||!detail||typeof detail!=='object'||Array.isArray(detail))return;
    const current=detail as Record<string,unknown>,id=current.id;
    if(typeof id!=='string'||!('assignment'in current&&'stage'in current))return;
    const latest=data.projections.workshopSessions?.find(value=>value.id===id);
    if(latest&&latest!==detail)setDetail(latest);
  }, [data,detail]);
  async function command(route: string, body: unknown) {
    setPending(true); setError('');
    try { const result = await api(route, body); setDetail(result); return true; }
    catch (e) { setError(String(e)); return false; } finally { setPending(false); }
  }
  async function stopRun(id:string){if(stopping)return;setStopping(true);setStopFeedback('Stop requested. Checking provider and game receipts…');
    const timer=setTimeout(()=>setStopFeedback('Stop is still being reconciled. Check stop status before starting another run.'),10000);
    try{await api('workshop/stop',{sessionId:id,reason:'operator_stop'});const raw=await api('workspace/requests/'+encodeURIComponent(id)) as {request:{state:string;reason:string|null}};
      setStopFeedback(`Stop status: ${raw.request.state}${raw.request.reason?` · ${raw.request.reason}`:''}`);
    }catch(e){setStopFeedback(`Stop outcome unconfirmed: ${String(e)}. Check stop status.`);}finally{clearTimeout(timer);setStopping(false);}
  }
  async function stopScenario(){if(stopping)return;setStopping(true);setStopFeedback('Scenario Stop requested. Checking game and inference receipts…');
    const timer=setTimeout(()=>setStopFeedback('Scenario Stop remains unconfirmed. Check the scenario control state before starting another run.'),10000);
    try{const state=await api('control',{action:'stop'}) as {status:string;cancellation:string;inference:string};
      setStopFeedback(`Scenario stop status: ${state.status} · cancellation ${state.cancellation} · inference ${state.inference}`);
    }catch(e){setStopFeedback(`Scenario Stop outcome unconfirmed: ${String(e)}. Check the control state.`);}finally{clearTimeout(timer);setStopping(false);}
  }
  const agents = data?.projections.agents ?? []; const tasks = data?.projections.tasks ?? [];
  const events = history.length ? history : data?.events ?? [];
  const controls = data?.control;
  const assisted = data?.projections.runs?.some(r => r.assisted === true);
  const budget = data?.projections.budgets?.[0] as { caps?: { turns: number; runMs: number; tokens: number | null }; state?: { spentTurns: number; elapsedMs: number; reportedTokens: number } } | undefined;
  return <main>
    <header><div className="brand">AF<span> / OPERATOR CONSOLE</span></div><div className="connection" role="status">● {connection}</div></header>
    <MainNavigation page={page} navigate={navigate}/>
    <section className="hero"><div><p className="eyebrow">THE FACTORY NEEDS NOBODY</p><h1>Control room<span>.</span></h1><p>Watch the work. Follow the evidence. Steer the next move.</p></div><div className="run"><span>ACTIVE RUN</span><strong>{data?.run ?? 'Connecting…'}</strong><small>Event {data?.cursor ?? '—'} · Game tick {show(controls?.gameTick)}</small></div></section>
    {error && <div className="alert" role="alert">{error}</div>}
    {completionFeedback&&<p className="notice" role="status" aria-live="polite">{completionFeedback}</p>}
    {owner && <section className="active-run-banner" aria-label="Active run"><div><strong>{owner.kind==='workshop'?'Workshop':'Scenario'} · {owner.id}</strong><span>{owner.state}{owner.reason?` · ${owner.reason}`:''}</span></div><div className="inline"><button type="button" onClick={()=>navigate(`/history/${owner.id}`)}>Open run</button><button type="button" disabled={stopping||owner.state==='stopping'} onClick={()=>void (owner.kind==='workshop'?stopRun(owner.id):stopScenario())}>Stop run</button></div></section>}
    {stopFeedback && <p className="notice" role="status" aria-live="polite">{stopFeedback}</p>}
    {page==='invalid'&&<section className="panel"><h2>Page unavailable</h2><button type="button" onClick={()=>navigate('/')}>Return to Overview</button></section>}
    {page==='overview'&&<section className="panel"><h2>Overview</h2><p>Game {controls?.connected?'connected':'disconnected'} · Provider {controls?.inference??'unconfirmed'}</p><p>{owner?`Active ${owner.kind} run ${owner.id}`:'No active managed run'}</p><div className="inline"><button type="button" onClick={()=>navigate('/workshop')}>Create workshop run</button><button type="button" onClick={()=>navigate('/history')}>Explore run history</button></div></section>}
    {(page==='workshop'||page==='library')&&<WorkshopPanel api={api} data={data} inspect={value=>beginInspect()(value)} beginInspect={beginInspect} mode={page==='workshop'?'setup':'library'} navigate={navigate} launchBlocked={Boolean(owner)}/>}
    {page==='library'&&libraryDetail!==undefined&&<section className="panel library-inspector" aria-label="Library result" aria-live="polite"><div className="sectiontitle"><h2>Library result</h2><button type="button" onClick={()=>{librarySelection.current++;setLibraryDetail(undefined);}}>Close result</button></div><p className="hint">Recorded revision details or native blueprint export. Copy the exported blueprint string to import it into Factorio.</p><pre>{json(libraryDetail)}</pre></section>}
    {page==='history'&&<RunHistory api={api} navigate={navigate} refresh={data?.cursor??0}/>}
    {page==='run'&&runId&&<RunDetail api={api} runId={runId} navigate={navigate} refresh={data?.cursor??0} stop={(id,kind)=>void (kind==='workshop'?stopRun(id):stopScenario())} currentRuntimeRun={data?.run??null}/>}
    {page==='scenarios'&&<>
    <section className="controlbar"><div><span className={'badge ' + controls?.status}>{controls?.status ?? 'Unconfirmed'}</span><small>Game {controls?.connected ? 'connected' : 'disconnected'} · Cancellation {controls?.cancellation ?? 'unconfirmed'} · Inference {controls?.inference ?? 'unconfirmed'} · Checkpoint {controls?.checkpoint ?? 'unknown'}</small></div><nav>{(['pause', 'stop', 'resume'] as const).map(action => <button key={action} disabled={pending || connection !== 'Live' || (action === 'resume' && controls?.scoringClosed)} onClick={() => void command('control', { action })}>{action}</button>)}</nav></section>
    {controls?.scoringClosed && <p className="alert">Budget closed. This run cannot earn further scored output.</p>}
    <p className="hint" data-testid="run-accounting"><strong>{assisted ? 'Assisted run' : 'No assistance recorded'}</strong> · Turns {show(budget?.state?.spentTurns)} / {show(budget?.caps?.turns)} · Wall time {Math.round((budget?.state?.elapsedMs ?? 0) / 1000)} / {Math.round((budget?.caps?.runMs ?? 0) / 1000)} seconds · Reported tokens {show(budget?.state?.reportedTokens)} / {show(budget?.caps?.tokens)}</p>
    <div className="layout"><div>
      <section className="panel"><div className="sectiontitle"><h2>Agent roster</h2><span>{agents.length} roles</span></div><div className="roster">{agents.map(a => <article className="agent" key={show(a.id)}><span className="agenticon">{show(a.id).slice(0, 1).toUpperCase()}</span><h3>{show(a.id)}</h3><p className="badge">{data ? roleState(a, data) : 'Unknown activity'}</p><p>{a.assignment ? 'Task: ' + show(a.assignment) : 'No current assignment'}</p><button onClick={() => setDetail(a)}>Inspect role →</button></article>)}</div></section>
      <section className="panel"><div className="sectiontitle"><h2>Committed work</h2><span>Dependencies & revisions</span></div>{!tasks.length && <p className="empty">No tasks committed yet.</p>}{tasks.map(t => <article className="task" key={show(t.id)}><div><strong>{show(t.goal)}</strong><p>{show(t.id)} · revision {show(t.revision)} · {show(t.owner)} · {show(t.status)} {t.wait ? ' / ' + show(t.wait) : ''}</p><p>Depends on: {(t.dependencies as string[] ?? []).join(' → ') || 'No dependencies'}</p></div><button onClick={() => setDetail(t)}>Evidence</button><button onClick={() => { const goal = prompt('Revised goal', show(t.goal)); if (goal) void command('reprioritize', { task: t.id, revision: t.revision, goal, committedPlan: t.committedPlan }); }}>Reprioritize</button></article>)}</section>
      <section className="panel"><h2>Batch progress</h2>{!(data?.projections.commands?.length) && <p className="empty">No construction batches submitted.</p>}{data?.projections.commands?.map((c, i) => { const b = c.batch as { commandId: string; steps: unknown[] }; const r = c.receipt as { status: string; completed: number } | null; return <article className="task" key={i}><div><strong>{b.commandId}</strong><p>{r?.status ?? show(c.state)} · {r?.completed ?? 0}/{b.steps.length} steps</p><progress max={b.steps.length} value={r?.completed ?? 0} /></div><button onClick={() => setDetail(c)}>Inputs / results</button></article>; })}</section>
      <section className="panel"><div className="sectiontitle"><h2>Production & measurements</h2><span>Engine evidence</span></div>{!data?.projections.measurements?.length && <p className="empty">Measurement telemetry unavailable.</p>}{data?.projections.measurements?.map((m, i) => <article className="measurement" key={i}><strong>{show(m.name)}</strong><small>Tick {show(m.gameTick)} · {m.complete ? 'Recorded' : 'Telemetry unavailable'} · {show(m.scoring ?? 'Independent measurement')}</small><pre>{json(m.value)}</pre></article>)}</section>
      <section className="panel"><div className="sectiontitle"><h2>Correlated timeline</h2><button onClick={() => { void api('history?after=' + historyCursor.current).then(v => { const page = v as Event[]; historyCursor.current = page.at(-1)?.sequence ?? historyCursor.current; setHistory(prior => [...prior, ...page]); }).catch(e => setError(String(e))); }}>Load durable history</button></div><p className="hint">{history.length ? 'Paged history from run start' : 'Latest 200 events; older evidence remains in durable history'}</p><div className="timeline">{events.slice().reverse().map(e => <button className="event" key={e.sequence} onClick={() => setDetail(e)}><span>#{e.sequence}</span><strong>{e.type}</strong><small>{e.wallTime.slice(11, 19)} · tick {show(e.gameTick)}</small></button>)}</div></section>
    </div><aside>
      <section className="panel steering"><p className="eyebrow">HUMAN IN THE LOOP</p><h2>Steer the next move</h2><p className="hint">Advice enters the selected role’s inbox. Receipt and interpretation are tracked separately.</p><form onSubmit={e => { e.preventDefault(); void command('advice', { id: adviceId.current, recipient, text: advice }).then(ok => { if (ok) { adviceId.current = crypto.randomUUID(); setAdvice(''); } }); }}><label>Recipient<select value={recipient} onChange={e => { setRecipient(e.target.value); adviceId.current = crypto.randomUUID(); }}>{agents.map(a => <option key={show(a.id)}>{show(a.id)}</option>)}</select></label><label>Advice<textarea value={advice} maxLength={8000} onChange={e => { setAdvice(e.target.value); adviceId.current = crypto.randomUUID(); }} placeholder="What should this role consider next?" /></label><button className="primary" disabled={pending || !advice.trim()}>Send advice →</button></form><p className="hint">Human advice marks this run assisted.</p></section>
      <section className="panel"><h2>Interventions</h2>{!data?.projections.interventions?.length && <p className="empty">No human interventions recorded.</p>}{data?.projections.interventions?.map(i => <button className="intervention" key={show(i.id)} onClick={() => setDetail(i)}><strong>{show(i.recipient ?? i.causality)}</strong><span>{show(i.delivery)}</span><p>{show(i.text ?? i.kind)}</p>{i.interpretation ? <p>{show(i.interpretation)}</p> : null}</button>)}</section>
      <section className="panel detail"><div className="sectiontitle"><h2>Evidence inspector</h2><button onClick={() => setDetail(undefined)}>Clear</button></div><p className="hint">Public activity, explicit explanations and recorded inputs/results.</p><pre>{detail === undefined ? 'Select a role, task, event or intervention.' : json(detail)}</pre><label>Observation / artifact ID<input placeholder="Paste a recorded artifact ID" onKeyDown={e => { if (e.key === 'Enter') void api('artifacts/' + encodeURIComponent(e.currentTarget.value)).then(setDetail).catch(e => setError(String(e))); }} /></label></section>
    </aside></div></>}<footer>AutoFactorio · Local operator session · Model allowance is unknown unless reported.</footer>
  </main>;
}
