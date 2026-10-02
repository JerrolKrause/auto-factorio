import { useEffect, useRef, useState } from 'react';
import type { WorkspaceGroupIdentity, WorkspaceRunIdentity, WorkspaceLifecycle } from '@autofactorio/contracts';
import type { Event } from '../../../packages/core/execution/durable.js';
import { AsyncFeedback, useAsyncActions } from './async-feedback.js';
import { useHistoryPage } from './history-page.js';

type Api = (route: string, body?: unknown) => Promise<unknown>;
type Run = { identity: WorkspaceRunIdentity; availability: string; registration: string; timeCoverage: string; requestState:string|null };
type Detail = { run: Run; group: WorkspaceGroupIdentity | null; session: Record<string, unknown> | null;
  scenarioControl: Record<string, unknown> | null; scenarioVerification: Record<string, unknown> | null;
  lifecycle: WorkspaceLifecycle; request: { state: string; reason: string | null } | null;
  learningOutcome:Record<string,unknown>|null;learningCandidate:Record<string,unknown>|null;
  learningBundle:Record<string,unknown>|null;activationCatalog:Record<string,unknown>|null;
  usage:Record<string,unknown>|null;operations:Record<string,unknown>[];operationCoverage:string;terminalAt:string|null };
const enc = encodeURIComponent;
const chronological=(left:{createdAt:string;id:string},right:{createdAt:string;id:string})=>left.createdAt.localeCompare(right.createdAt)||left.id.localeCompare(right.id);
const title = (run: Run) => `${run.identity.kind === 'workshop' ? 'Workshop' : 'Scenario'} · ${new Date(run.identity.createdAt).toLocaleString()}`;

export function RunHistory({ api, navigate, refresh }: { api: Api; navigate: (url: string) => void; refresh: number }) {
  const [retry,setRetry]=useState(0);
  const actions=useAsyncActions(`${refresh}:${retry}`);
  const [selected, setSelected] = useState<string | null>(null);
  // Group identities omit time; retain the server's refreshed prefix order.
  const groupPage=useHistoryPage<WorkspaceGroupIdentity>({api,route:'workspace/groups?limit=50',refresh,retry,key:value=>value.id,compare:()=>0});
  const runPage=useHistoryPage<Run>({api,route:selected?`workspace/groups/${enc(selected)}/runs?limit=50`:null,refresh,retry,key:value=>value.identity.id,compare:(left,right)=>chronological(left.identity,right.identity)});
  const groups=groupPage.items,groupCursor=groupPage.next,loadingGroups=groupPage.loading;
  const runs=runPage.items,runCursor=runPage.next,loadingRuns=runPage.loading;
  const [summary,setSummary]=useState<{active:number;finished:number;targetAchieved:number;targetNotYetAchieved:number;unknown:number;coverage:string;runCount:number}|null>(null);
  const [summaryGroup,setSummaryGroup]=useState<string|null>(null);
  const [summaryError, setError] = useState<{group:string;message:string}|null>(null);
  const error=(summaryError?.group===selected?summaryError.message:'')||groupPage.error||runPage.error;
  const [filter, setFilter] = useState('');
  const [statusFilter,setStatusFilter]=useState('');const[from,setFrom]=useState('');const[to,setTo]=useState('');
  useEffect(()=>{setSelected(value=>value??groups[0]?.id??null);},[groups]);
  useEffect(()=>{setError(null);if(!selected){setSummary(null);return;}let cancelled=false;void api(`workspace/groups/${enc(selected)}/summary`).then(raw=>{if(!cancelled){setSummary(raw as NonNullable<typeof summary>);setSummaryGroup(selected);setError(null);}}).catch(e=>!cancelled&&setError({group:selected,message:String(e)}));return()=>{cancelled=true;};},[api,selected,refresh,retry]);
  async function moreGroups() { await actions.run('groups','Loading more groups…',()=>groupPage.more(),'Groups loaded.'); }
  async function moreRuns() { await actions.run('runs','Loading more runs…',()=>runPage.more(),'Runs loaded.'); }
  const visible = runs.filter(run => (!filter || `${run.identity.id} ${JSON.stringify(run.identity.assignment)}`.toLowerCase().includes(filter.toLowerCase())) &&
    (!statusFilter||run.requestState===statusFilter) && (!from||run.identity.createdAt.slice(0,10)>=from) && (!to||run.identity.createdAt.slice(0,10)<=to));
  const selectedGroup=groups.find(value=>value.id===selected);
  return <section className="panel workspace-page"><div className="sectiontitle"><div><p className="eyebrow">RUN HISTORY</p><h2>Briefs, scenarios and runs</h2></div></div>
    <AsyncFeedback actions={actions}/>
    {error && <div className="alert" role="alert">{error} <button type="button" onClick={()=>{setError(null);setRetry(value=>value+1);}}>Retry history</button></div>}
    {loadingGroups&&<p role="status">Loading history…</p>}
    {!loadingGroups&&!groups.length && !error && <p className="empty">No retained run history yet.</p>}
    <div className="history-layout"><div><h3>Briefs and scenarios</h3>{groups.map(group => <button type="button" key={group.id} className="history-row" aria-pressed={selected === group.id} onClick={() => setSelected(group.id)}>
      <strong>{group.title}</strong><small>{group.kind} · {group.coverage === 'recorded' ? 'Recorded identity' : 'Legacy identity unknown'}</small></button>)}
      {groupCursor && <button type="button" disabled={groupPage.pending} onClick={() => void moreGroups()}>{groupPage.pending?'Loading more groups…':'More groups'}</button>}</div>
      <div><h3>Runs</h3>{summaryGroup===selected&&summary&&<p className="hint">{summary.active} active · {summary.finished} finished · {summary.targetAchieved} target achieved · {summary.targetNotYetAchieved} target not yet achieved · {summary.unknown} unknown ({summary.coverage})</p>}{selectedGroup?.kind==='brief'&&<button type="button" onClick={()=>navigate(`/workshop?group=${enc(selectedGroup.id)}`)}>Run this brief again</button>}
        <div className="history-filters"><label>Search selected group<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Run ID or configuration" /></label><label>Status<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">All statuses</option>{['preparing','active','stopping','held','completed','cancelled','failed'].map(value=><option key={value}>{value}</option>)}</select></label><label>From date<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To date<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
        {loadingRuns&&<p role="status">Loading runs…</p>}
        {!loadingRuns&&!visible.length && <p className="empty">No matching runs in this group.</p>}
        {visible.map((run, index) => <a className="history-row" href={`/history/${enc(run.identity.id)}`} key={run.identity.id}
          onClick={event => { event.preventDefault(); navigate(`/history/${enc(run.identity.id)}`); }}>
          <strong>{title(run)}</strong><span>Run {index + 1} · {run.requestState??'Status unknown'} · {run.identity.id}</span><small>{run.availability === 'available' ? 'Evidence available' : `Evidence ${run.availability}`} · {run.timeCoverage === 'recorded' ? 'Time recorded' : 'Time unknown'}</small>
        </a>)}{runCursor && <button type="button" disabled={loadingRuns} onClick={() => void moreRuns()}>{loadingRuns?'Loading more runs…':'More runs'}</button>}
      </div></div></section>;
}

export function RunDetail({ api, runId, navigate, refresh, stop, currentRuntimeRun }: { api: Api; runId: string; navigate: (url: string) => void; refresh: number; stop: (id: string,kind:'workshop'|'scenario') => void; currentRuntimeRun:string|null }) {
  const actions=useAsyncActions(runId);
  const [retry,setRetry]=useState(0);
  const requestScope=useRef({runId});
  if(requestScope.current.runId!==runId)requestScope.current={runId};
  const invocationSerial=useRef(0);
  const priorRun = useRef<string | null>(null);
  const focusedRun = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [detail, setDetail] = useState<Detail>();
  const [pendingRequest, setPendingRequest] = useState<{state:string;reason:string|null}|null>(null);
  const attemptPage=useHistoryPage<{id:string;ordinal:number;sourceId?:string|null;coverage:string}>({api,route:`workspace/runs/${enc(runId)}/attempts?limit=50`,refresh,retry,key:value=>value.id,compare:(left,right)=>left.ordinal-right.ordinal||left.id.localeCompare(right.id)});
  const eventPage=useHistoryPage<Event>({api,route:`workspace/runs/${enc(runId)}/events?limit=50`,refresh,retry,key:value=>value.sequence,compare:(left,right)=>left.sequence-right.sequence});
  const attempts=attemptPage.items,attemptCursor=attemptPage.next,events=eventPage.items,eventCursor=eventPage.next;
  const [selectedAttempt, setSelectedAttempt] = useState<string | null>(null);
  const [inspected, setInspected] = useState<Event | null>(null);
  const [invocation, setInvocation] = useState<{id:string;part:'instructions'|'context'|'messages'|'output';text:string;next:number|null;total:number;status:string;coverage:string}|null>(null);
  const [detailError, setError] = useState('');
  const error=detailError||(detail?.run.identity.id===runId?(attemptPage.error||eventPage.error):'');
  useEffect(()=>{if(detail?.run.identity.id===runId&&focusedRun.current!==runId){heading.current?.focus();focusedRun.current=runId;}},[detail,runId]);
  useEffect(() => { let cancelled = false;const scope=requestScope.current;
    if (priorRun.current !== runId) { priorRun.current = runId; invocationSerial.current++; setDetail(undefined); setPendingRequest(null); setInspected(null); setInvocation(null); setSelectedAttempt(null); setError(''); }
    void api(`workspace/runs/${enc(runId)}/detail`).then(raw => {
      if (cancelled||requestScope.current!==scope) return;
      setPendingRequest(null);setDetail(raw as Detail);
    }).catch(async e => {try {const raw=await api(`workspace/requests/${enc(runId)}`) as {request:{state:string;reason:string|null}};
      if(!cancelled&&requestScope.current===scope)setPendingRequest(raw.request);}catch {if(!cancelled&&requestScope.current===scope)setError(String(e));}});
    return () => { cancelled = true; }; }, [api, runId, refresh,retry]);
  async function moreAttempts() {await actions.run('attempts','Loading more attempts…',()=>attemptPage.more(),'Attempts loaded.');}
  async function moreEvents() {await actions.run('events','Loading more activity…',()=>eventPage.more(),'Activity loaded.');}
  async function checkpoint(action:'continue'|'finish') {await actions.run('checkpoint','Submitting checkpoint decision…',async current=>{const fresh=await api(`workspace/runs/${enc(runId)}/detail`) as Detail;
    if(!current())return;
    if(fresh.session?.stage!=='checkpoint')throw new Error('Checkpoint changed; refresh run detail');
    await api('workshop/checkpoint',{sessionId:runId,revision:Number(fresh.session.steeringRevision)+1,action,text:action==='continue'?'Operator approved checkpoint':'Operator finished at checkpoint'});
  },'Checkpoint decision recorded.');}
  async function learningControl(action:'rollback'|'quarantine',hash:string){await actions.run('learning','Updating learning control…',async()=>{await api('workshop/learning',action==='rollback'?{action,hash,operationId:crypto.randomUUID()}:{action,hash,reason:'Operator quarantine'});},'Learning control recorded.');}
  async function inspectInvocation(id:string,part:'instructions'|'context'|'messages'|'output',offset=0){
    await actions.run(`invocation:${id}:${part}`,'Loading recorded evidence…',async current=>{
      const serial=offset?invocationSerial.current:++invocationSerial.current;
      if(!offset)setInvocation(null);
      try{const page=await api(`workspace/runs/${enc(runId)}/invocations/${enc(id)}?part=${part}&offset=${offset}`) as NonNullable<typeof invocation>;
        if(!current()||invocationSerial.current!==serial)return;
        setInvocation(value=>offset&&value?.id===id&&value.part===part?{...page,text:value.text+page.text}:page);
      }catch(error){if(current()&&invocationSerial.current===serial)setInvocation({id,part,text:`Not retained or unavailable: ${String(error)}`,next:null,total:0,status:'unavailable',coverage:'not-retained'});throw error;}
    },'Recorded evidence loaded.');
  }
  const session = detail?.session;
  const iterations = (session?.iterations ?? []) as Record<string, unknown>[];
  const bestNumber=typeof session?.bestIteration==='number'?session.bestIteration:null;
  const best=bestNumber===null?null:iterations[bestNumber-1]??null;
  const bestScore=best?.score as {eligible?:boolean;dimensions?:Record<string,{value:number|null;unit:string}>}|undefined;
  const throughput=bestScore?.dimensions?.throughput;
  const duration=detail?.terminalAt?Date.parse(detail.terminalAt)-Date.parse(detail.run.identity.createdAt):NaN;
  const current = detail?.request && detail.run.identity.runtimeRun===currentRuntimeRun && ['active', 'preparing', 'stopping', 'held'].includes(detail.request.state);
  const activeAttempt = session?.activeIteration ? `${runId}:${session.activeIteration}` : null;
  const sourceAttempt=attempts.find(value=>value.id===selectedAttempt)?.sourceId??selectedAttempt;
  const sourceSession=typeof session?.id==='string'?session.id:runId;
  const visibleEvents = sourceAttempt ? events.filter(event => event.changes.some(change => change.id === sourceAttempt || change.id.startsWith(`${sourceAttempt}:`) || change.value.id === sourceAttempt)) : events;
  return <section className="panel workspace-page"><button type="button" onClick={() => navigate('/history')}>← Run History</button>
    <AsyncFeedback actions={actions}/>
    {error && <div className="alert" role="alert">{error} <button type="button" onClick={()=>{setError('');setRetry(value=>value+1);}}>Retry run detail</button></div>}
    {!detail && !error && !pendingRequest && <p role="status">Loading run…</p>}
    {pendingRequest && !detail && <div role="status"><h2>{['cancelled','failed','completed'].includes(pendingRequest.state)?`Run ${pendingRequest.state}`:'Preparing run'}</h2><p>{pendingRequest.state}{pendingRequest.reason?` · ${pendingRequest.reason}`:''}</p>
      {['preparing','active','stopping','held'].includes(pendingRequest.state)&&<button type="button" onClick={() => stop(runId,'workshop')}>Stop run</button>}
      <p className="hint">No run journal has been registered for this request.</p></div>}
    {detail && <><div className="sectiontitle"><div><p className="eyebrow">{detail.group?.title ?? 'Retained run'}</p><h2 ref={heading} tabIndex={-1}>{title(detail.run)}</h2></div><span>{detail.lifecycle.execution}</span></div>
      <p className="hint">{detail.lifecycle.phase} · Target: {detail.lifecycle.evaluation} · Result: {detail.lifecycle.result}{detail.lifecycle.scenarioVerdict ? ` · Scenario verdict: ${detail.lifecycle.scenarioVerdict}` : ''}</p>
      {detail.lifecycle.partialEarlierSuccess && <p className="notice">An earlier passing attempt is retained. This run did not complete successfully.</p>}
      {detail.lifecycle.reason && <p className="hint">{detail.lifecycle.reason}</p>}
      {['completed','cancelled','failed'].includes(detail.lifecycle.execution)&&<section className="terminal-summary" aria-label="Terminal run summary"><h3>Run summary</h3>
        <p>Result: {detail.lifecycle.result}{detail.lifecycle.reason?` · ${detail.lifecycle.reason}`:''}. Attempts: {session&&Array.isArray(session.iterations)?iterations.length:'unknown'}.
          Best eligible: {bestNumber!==null&&bestScore?.eligible?`attempt ${bestNumber}${throughput?.value!==null&&throughput?.value!==undefined?` · ${throughput.value} ${throughput.unit}`:''}`:'none recorded'}.
          Elapsed: {Number.isFinite(duration)&&duration>=0?`${Math.round(duration/1000)} seconds`:'unknown'}.</p>
        <p><a href="#attempts">Attempt evidence</a> · <a href="#activity">Run activity</a></p></section>}
      {detail.run.availability !== 'available' && <p className="alert">Retained journal {detail.run.availability}; details are unavailable.</p>}
      {current && <button type="button" onClick={() => stop(runId,detail.run.identity.kind)}>Stop run</button>}
      {current && session?.stage==='checkpoint' && <div className="notice"><strong>Waiting for you · {String((session.checkpoint as Record<string,unknown>|null)?.kind??'checkpoint')}</strong><div className="inline"><button type="button" disabled={actions.pending('checkpoint')} onClick={() => void checkpoint('continue')}>Continue</button><button type="button" disabled={actions.pending('checkpoint')} onClick={() => void checkpoint('finish')}>Finish after this attempt</button></div></div>}
      <details><summary>Configuration and provenance</summary><pre>{JSON.stringify(detail.run.identity.assignment, null, 2)}</pre><small>Runtime {detail.run.identity.runtimeRun} · Assignment {detail.run.identity.assignmentHash}</small></details>
      {detail.run.identity.kind === 'scenario' && <div><h3>Scenario control</h3><pre>{JSON.stringify(detail.scenarioControl ?? 'Not retained', null, 2)}</pre><h3>Independent verification</h3><pre>{JSON.stringify(detail.scenarioVerification ?? 'Not retained', null, 2)}</pre><p className="hint">Historical scenario controls are read only.</p></div>}
      {detail.run.identity.kind==='workshop'&&<details><summary>Learning and activation</summary>
        <p className="hint">{detail.learningOutcome?`${String(detail.learningOutcome.decision)} · ${String(detail.learningOutcome.reason)}`:'No learning outcome retained for this run.'}</p>
        {detail.learningOutcome&&<pre>{JSON.stringify(detail.learningOutcome,null,2)}</pre>}
        {detail.learningCandidate&&<pre>{JSON.stringify(detail.learningCandidate,null,2)}</pre>}
        {detail.learningBundle&&<pre>{JSON.stringify(detail.learningBundle,null,2)}</pre>}
        {detail.activationCatalog&&<p className="hint">Active generation {String(detail.activationCatalog.generation)} · {String(detail.activationCatalog.activeHash)}</p>}
        {currentRuntimeRun===detail.run.identity.runtimeRun&&detail.activationCatalog&&<div className="inline">
          {typeof detail.activationCatalog.activeHash==='string'&&detail.activationCatalog.activeHash!=='baseline'&&<button type="button" onClick={()=>void learningControl('quarantine',String(detail.activationCatalog!.activeHash))}>Quarantine active bundle</button>}
          {(Array.isArray(detail.activationCatalog.verifiedHashes)?detail.activationCatalog.verifiedHashes:[]).filter(value=>value!==detail.activationCatalog?.activeHash).map(value=><button type="button" key={String(value)} onClick={()=>void learningControl('rollback',String(value))}>Roll back to {String(value).slice(0,12)}</button>)}
        </div>}
        {currentRuntimeRun!==detail.run.identity.runtimeRun&&<p className="hint">Historical learning controls are read only in this dashboard.</p>}
      </details>}
      {detail.run.identity.kind==='workshop'&&<div><h3>Usage</h3><p className="hint">Reported tokens {String(detail.usage?.totalTokens??'unknown')} · Unknown invocations {Array.isArray(detail.usage?.unknownTokenInvocations)?detail.usage.unknownTokenInvocations.length:'unknown'}</p>
        {detail.usage&&<details><summary>Usage by role and attempt</summary><pre>{JSON.stringify({byRole:detail.usage.byRole,byIteration:detail.usage.byIteration,byOwner:detail.usage.byOwner},null,2)}</pre></details>}</div>}
      <h3 id="activity">Run-level activity</h3><p className="hint">{detail.operationCoverage==='complete'?'Recorded operation projections':`Operation coverage: ${detail.operationCoverage}`}</p>
      {detail.operations.filter(operation=>operation.iteration===null||operation.iteration===undefined).map((operation,index)=><div className="history-row" key={`${String(operation.id)}-${index}`}><strong>{String(operation.category??'Operation')} · {String(operation.status??'unknown')}</strong><small>{String(operation.detail??operation.at??'')}</small></div>)}
      <h3 id="attempts">Attempts</h3>{!attempts.length && <p className="empty">No attempt identity retained.</p>}
      {attempts.map(attempt => <div key={attempt.id} className="history-row"><button type="button" aria-expanded={selectedAttempt === attempt.id} onClick={() => {invocationSerial.current++;setSelectedAttempt(value => value === attempt.id ? null : attempt.id);setInvocation(null);setInspected(null);}}>
        Attempt {attempt.ordinal} · {attempt.id}{activeAttempt === attempt.id ? ' · Current' : ''}</button>
        {selectedAttempt === attempt.id && <><pre>{JSON.stringify(iterations.find(value => value.id === (attempt.sourceId??attempt.id)) ?? { coverage: attempt.coverage, detail: 'Not retained' }, null, 2)}</pre>
          {detail.operations.filter(operation=>operation.iteration===attempt.ordinal).map((operation,index)=><div className="history-row" key={`${String(operation.id)}-${index}`}><strong>{String(operation.category??'Operation')} · {String(operation.status??'unknown')}</strong><small>{String(operation.detail??operation.at??'')}</small></div>)}
          {detail.run.identity.kind==='workshop'&&<div className="inline"><button type="button" onClick={()=>void inspectInvocation(`${sourceSession}:${attempt.ordinal}:designer`,'instructions')}>Designer instructions</button><button type="button" onClick={()=>void inspectInvocation(`${sourceSession}:${attempt.ordinal}:designer`,'context')}>Designer context</button><button type="button" onClick={()=>void inspectInvocation(`${sourceSession}:${attempt.ordinal}:designer`,'messages')}>Designer tools</button><button type="button" onClick={()=>void inspectInvocation(`${sourceSession}:${attempt.ordinal}:designer`,'output')}>Designer output</button><button type="button" onClick={()=>void inspectInvocation(`${sourceSession}:${attempt.ordinal}:scorer`,'context')}>Scorer context</button><button type="button" onClick={()=>void inspectInvocation(`${sourceSession}:${attempt.ordinal}:scorer`,'messages')}>Scorer tools</button><button type="button" onClick={()=>void inspectInvocation(`${sourceSession}:${attempt.ordinal}:scorer`,'output')}>Scorer output</button></div>}
          {current && activeAttempt === attempt.id && <button type="button" onClick={() => stop(runId,detail.run.identity.kind)}>Stop run and remaining attempts</button>}</>}</div>)}
      {attemptCursor && <button type="button" disabled={attemptPage.pending} onClick={() => void moreAttempts()}>{attemptPage.pending?'Loading more attempts…':'More attempts'}</button>}
      <h3>{selectedAttempt ? 'Attempt event timeline' : 'Retained event timeline'}</h3>
      <div className="timeline">{visibleEvents.map(event => <button type="button" className="event" key={event.sequence} onClick={() => setInspected(event)}>
        <span>#{event.sequence}</span><strong>{event.type}</strong><small>{event.wallTime}</small></button>)}</div>
      {eventCursor && <button type="button" disabled={eventPage.pending} onClick={() => void moreEvents()}>{eventPage.pending?'Loading more activity…':'More activity'}</button>}
      {invocation && <section className="evidence-inspector"><div className="sectiontitle"><h3>{invocation.part} · {invocation.id}</h3><button type="button" onClick={()=>setInvocation(null)}>Close</button></div>
        <p className="hint">{invocation.coverage==='recorded'?'Full recorded part':invocation.coverage==='redacted'?'Recorded part with redactions':`Evidence ${invocation.coverage}`} · {invocation.status} · {invocation.text.length} of {invocation.total} characters</p>
        <pre>{invocation.text}</pre>{invocation.next!==null&&<button type="button" onClick={()=>void inspectInvocation(invocation.id,invocation.part,invocation.next!)}>More recorded content</button>}</section>}
      {inspected && <section className="evidence-inspector"><div className="sectiontitle"><h3>Recorded event #{inspected.sequence}</h3><button type="button" onClick={() => setInspected(null)}>Close</button></div>
        <p className="hint">Recorded projection and event envelope. Other context may not have been retained.</p><pre>{JSON.stringify(inspected, null, 2)}</pre></section>}
    </>}</section>;
}
