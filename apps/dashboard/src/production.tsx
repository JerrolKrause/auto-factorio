import { useEffect, useState } from 'react';
import type { ProductionStatusPage, ProductionStageStatus, ProductionProduct } from '@autofactorio/contracts';
type Api = (route: string) => Promise<unknown>;
interface Plan { id: string; revision: number; status: string; target: ProductionProduct; stageCount: number; blockers: { detail: string }[]; omittedBlockers: number }
interface Plans { plans: Plan[]; next: number | null; omitted: number }
export function ProductionActivity({ api, inspect, planVersion }: { api: Api; inspect: (value: unknown) => void; planVersion: number }) {
  const [plans, setPlans] = useState<Plans>(), [stages, setStages] = useState<ProductionStatusPage>(), [selected, setSelected] = useState<Plan>(), [error, setError] = useState('');
  const [pending, setPending] = useState(false), [planPending, setPlanPending] = useState(false);
  const [planOffset, setPlanOffset] = useState(0), [refresh, setRefresh] = useState(0);
  // Invalidate only on plan events/reconnect or explicit refresh; routine sample ticks do not poll the list.
  // Retire obsolete responses while keeping the current page and selected immutable revision.
  useEffect(() => {
    let live = true; setPlanPending(true); setError('');
    void api(`production/plans?offset=${planOffset}`).then(v => { if (live) setPlans(v as Plans); }).catch(e => { if (live) setError(String(e)); }).finally(() => { if (live) setPlanPending(false); });
    return () => { live = false; };
  }, [api, planOffset, planVersion, refresh]);
  async function load(plan: Plan, offset = 0) { setPending(true); setError(''); try { const page = await api(`production/plans/${plan.id}/${plan.revision}/stages?offset=${offset}`) as ProductionStatusPage; setSelected(plan); setStages(page); } catch (e) { setError(String(e)); } finally { setPending(false); } }
  function nextPlans() { if (plans?.next === null || plans?.next === undefined) return; setPlanOffset(plans.next); setSelected(undefined); setStages(undefined); }
  return <section className="panel" aria-label="Production plans"><h2>Production plans</h2><button disabled={planPending} onClick={() => setRefresh(value => value + 1)}>Refresh production plans</button><p className="hint">Construction, measured health and independent scenario verdict remain separate.</p>{error && <p role="alert">{error}</p>}{!plans?.plans.length && <p>No production plans recorded.</p>}
    {plans?.plans.map(plan => <article className="task" key={`${plan.id}.${plan.revision}`}><div><strong>{plan.target.name}</strong><p>Revision {plan.revision} · {plan.status} · {plan.stageCount} stages</p>{plan.blockers.map((b, i) => <p key={i}>{b.detail}</p>)}{plan.omittedBlockers > 0 && <p>{plan.omittedBlockers} more blockers</p>}</div><button disabled={pending || planPending} onClick={() => { void load(plan); }}>Inspect stages</button></article>)}
    {plans?.next !== null && plans?.next !== undefined && <button disabled={pending || planPending} onClick={() => { nextPlans(); }}>Next plans ({plans.omitted} remaining)</button>}
    {selected && <div aria-label="Production stage progress"><h3>{selected.target.name} · revision {selected.revision}</h3><button disabled={pending || planPending} onClick={() => { void load(selected); }}>Refresh stage observations</button>{stages?.stages.map(stage => <Stage key={stage.stage} stage={stage} inspect={inspect} />)}{stages?.next !== null && stages?.next !== undefined && <button disabled={pending || planPending} onClick={() => { void load(selected, stages.next!); }}>Next stages ({stages.omitted} remaining)</button>}</div>}
  </section>;
}
function Stage({ stage, inspect }: { stage: ProductionStageStatus; inspect: (value: unknown) => void }) {
  return <article className="task production-stage"><div><strong>{stage.recipe}</strong><p>Task {stage.task ?? 'Not committed'} · revision {stage.taskRevision ?? 'Unknown'} · construction {stage.progress?.construction ?? 'Unknown'} · health {stage.health}</p><p>Independent scenario verdict: not evaluated</p>{stage.tick !== null && <p>Observed game tick {stage.tick}</p>}{stage.exceptions.map((e, i) => <p key={i}>{e.kind}: {e.detail}</p>)}{stage.hypotheses.map((h, i) => <p key={i}>Hypothesis: {h}</p>)}{stage.omitted > 0 && <p>{stage.omitted} measurements omitted; retrieve scoped detail.</p>}</div><button onClick={() => inspect(stage)}>Stage evidence</button></article>;
}
