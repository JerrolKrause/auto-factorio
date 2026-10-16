import type { Rational, ThroughputRule, WorkshopAssignment, WorkshopEvaluationReport, WorkshopWindowMeasurement, WorkshopStageRequirement } from '@autofactorio/contracts';

type Fraction={n:bigint;d:bigint};
const gcd=(a:bigint,b:bigint):bigint=>b===0n?(a<0n?-a:a):gcd(b,a%b);
const fraction=(value:Rational):Fraction=>{const n=BigInt(value.numerator),d=BigInt(value.denominator);if(d<=0n)throw new Error('Invalid rational denominator');const g=gcd(n,d);return{n:n/g,d:d/g};};
const output=(value:Fraction):Rational=>{const g=gcd(value.n,value.d);return{numerator:(value.n/g).toString(),denominator:(value.d/g).toString()};};
const sub=(a:Fraction,b:Fraction):Fraction=>({n:a.n*b.d-b.n*a.d,d:a.d*b.d});
const mul=(a:Fraction,b:Fraction):Fraction=>({n:a.n*b.n,d:a.d*b.d});
const div=(a:Fraction,b:Fraction):Fraction=>{if(b.n===0n)throw new Error('Division by zero');return{n:a.n*b.d,d:a.d*b.n};};
const cmp=(a:Fraction,b:Fraction)=>{const d=a.n*b.d-b.n*a.d;return d<0n?-1:d>0n?1:0;};
const floor=(a:Fraction)=>{if(a.n<0n)return-((-a.n+a.d-1n)/a.d);return a.n/a.d;};
const ceil=(a:Fraction)=>{if(a.n<0n)return-((-a.n)/a.d);return(a.n+a.d-1n)/a.d;};
const zero:Fraction={n:0n,d:1n};
const measurementRational = (value: Rational): boolean => !!value && typeof value.numerator === 'string' && typeof value.denominator === 'string' && /^\d{1,155}$/.test(value.numerator) && /^[1-9]\d{0,154}$/.test(value.denominator);
export function requiredQuantity(rate:Rational,windowTicks:number,quantum:Rational):Rational{
  const raw=mul(fraction(rate),{n:BigInt(windowTicks),d:60n});const q=fraction(quantum);return output(mul(q,{n:ceil(div(raw,q)),d:1n}));
}
export function conservativeLower(observed:Rational,error:Rational,quantum:Rational):Rational{
  const adjusted=sub(fraction(observed),fraction(error));if(cmp(adjusted,zero)<=0)return{numerator:'0',denominator:'1'};const q=fraction(quantum);return output(mul(q,{n:floor(div(adjusted,q)),d:1n}));
}
function absolute(value:Fraction):Fraction{return value.n<0n?{n:-value.n,d:value.d}:value;}
function evaluatePort(rule:ThroughputRule,assignment:WorkshopAssignment,windows:WorkshopWindowMeasurement[]){
  const port=assignment.ports.find(p=>p.id===rule.portId);if(!port)throw new Error('Unknown throughput port');const required=requiredQuantity(port.rate,rule.windowTicks,rule.quantum);
  return{portId:port.id,windows:windows.map(window=>{const reasons:string[]=[];const measurement=window.ports.find(p=>p.portId===port.id);if(!measurement){reasons.push('missing_port_measurement');return{index:window.index,required,productionLower:{numerator:'0',denominator:'1'},deliveryLower:{numerator:'0',denominator:'1'},passed:false,reasons};}
    const productionLower=conservativeLower(measurement.production,rule.productionError,rule.quantum),deliveryLower=conservativeLower(measurement.delivery,rule.deliveryError,rule.quantum);if(cmp(fraction(productionLower),fraction(required))<0)reasons.push('production_below_target');if(cmp(fraction(deliveryLower),fraction(required))<0)reasons.push('delivery_below_target');const drawdown=sub(fraction(measurement.openingStock),fraction(measurement.closingStock));if(cmp(drawdown,fraction(rule.maxStockDrawdown))>0)reasons.push('stock_drawdown');if(cmp(absolute(fraction(measurement.residual)),fraction(rule.maxResidual))>0)reasons.push('balance_residual');if(measurement.coverage!=='complete')reasons.push('port_coverage_incomplete');return{index:window.index,required,productionLower,deliveryLower,passed:reasons.length===0,reasons};})};
}
export function evaluateWorkshop(assignment:WorkshopAssignment,windows:WorkshopWindowMeasurement[],stages?:WorkshopStageRequirement[],coProducts?: (ThroughputRule & {requiredRate:Rational})[]):WorkshopEvaluationReport{
  if(!windows.length)throw new Error('No workshop measurement windows');const attemptId=windows[0]!.attemptId;const reasons:string[]=[];const indexes=new Set<number>(),allocations=new Set<string>();let previousEnd:number|undefined;
  for(const window of windows){if(window.attemptId!==attemptId||window.interval!=='(startTick,endTick]'||window.endTick-window.startTick!==assignment.throughput[0]?.windowTicks||indexes.has(window.index)||previousEnd!==undefined&&window.startTick!==previousEnd)reasons.push('window_boundary_invalid');indexes.add(window.index);previousEnd=window.endTick;if(!window.connected)reasons.push('measurement_disconnected');if(!window.mutationsFrozen)reasons.push('mutations_not_frozen');if(window.stageCoverage!=='complete')reasons.push('stage_coverage_incomplete');if(window.energyCoverage!=='complete')reasons.push('energy_coverage_incomplete');if(window.contamination.length)reasons.push('measurement_contaminated');for(const port of window.ports){const key=`${window.index}:${port.productionAllocationId}`;if(allocations.has(key))reasons.push('duplicate_production_allocation');allocations.add(key);}}
  if (assignment.productionMode === 'chain') {
    if (!stages?.length) reasons.push('chain_manifest_missing');
    const sinks = assignment.ports.filter(port => port.direction === 'byproduct');
    if (!coProducts || coProducts.length !== sinks.length || new Set(coProducts.map(rule => rule.portId)).size !== sinks.length || sinks.some(port => !coProducts.some(rule => rule.portId === port.id))) reasons.push('chain_coproduct_manifest_missing');
    for (const rule of coProducts ?? []) {
      const boundary = {...assignment, ports: assignment.ports.map(port => port.id === rule.portId ? {...port, rate: rule.requiredRate} : port)};
      const result = evaluatePort(rule, boundary, windows);
      if (result.windows.some(window => !window.passed)) reasons.push('chain_coproduct_delivery_failed');
      const first = windows[0]?.ports.find(port => port.portId === rule.portId), last = windows.at(-1)?.ports.find(port => port.portId === rule.portId);
      if (first && last && cmp(sub(fraction(last.closingStock), fraction(first.openingStock)), fraction(rule.maxResidual)) > 0) reasons.push('chain_coproduct_accumulation');
    }
    for (const window of windows) {
      const measurements = window.stages ?? [];
      if (measurements.length !== stages?.length || new Set(measurements.map(value => value.id)).size !== measurements.length) reasons.push('chain_stage_coverage_incomplete');
      for (const stage of stages ?? []) {
        const measured = measurements.find(value => value.id === stage.id);
        if (!measured || measured.recipe !== stage.recipe || measured.machine !== stage.machine || measured.coverage !== 'complete' || !measured.evidence.length) { reasons.push('chain_stage_coverage_incomplete'); continue; }
        if (!measurementRational(measured.crafts)) { reasons.push('chain_measurement_invalid'); continue; }
        const requiredCrafts = mul(fraction(stage.craftsPerSecond), { n: BigInt(window.endTick - window.startTick), d: 60n });
        if (cmp(fraction(measured.crafts), requiredCrafts) < 0) reasons.push('chain_stage_below_target');
        for (const direction of ['inputs', 'outputs'] as const) {
          const rows = measured[direction];
          if (rows.length !== stage[direction].length || new Set(rows.map(value => `${value.kind}:${value.name}`)).size !== rows.length) reasons.push('chain_flow_coverage_incomplete');
          for (const flow of stage[direction]) {
            const row = rows.find(value => value.kind === flow.kind && value.name === flow.name);
            if (!row) { reasons.push('chain_flow_coverage_incomplete'); continue; }
            if (!measurementRational(row.amount) || !measurementRational(row.error)) { reasons.push('chain_measurement_invalid'); continue; }
            const lower = sub(fraction(row.amount), fraction(row.error));
            if (cmp(lower, mul(fraction(flow.amount), requiredCrafts)) < 0) reasons.push('chain_stage_below_target');
          }
        }
      }
    }
  }
  if(windows.length!==Math.max(...assignment.throughput.map(t=>t.windows)))reasons.push('window_count_incomplete');const ports=assignment.throughput.map(rule=>evaluatePort(rule,assignment,windows));if(ports.some(port=>port.windows.some(window=>window.reasons.includes('port_coverage_incomplete'))))reasons.push('port_coverage_incomplete');if(ports.some(port=>port.windows.some(window=>!window.passed)))reasons.push('sustained_target_failed');const unique=[...new Set(reasons)];return{schema:1,attemptId,valid:unique.every(r=>r==='sustained_target_failed'||r==='chain_stage_below_target'||r==='chain_coproduct_delivery_failed'),passed:unique.length===0, reasons:unique,ports,evidence:[...new Set(windows.flatMap(w=>[...w.evidence,...w.ports.flatMap(p=>p.evidence),...(w.stages ?? []).flatMap(stage => stage.evidence)]))]};
}
