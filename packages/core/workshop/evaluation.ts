import type { Rational, ThroughputRule, WorkshopAssignment, WorkshopEvaluationReport, WorkshopWindowMeasurement } from '@autofactorio/contracts';

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
export function evaluateWorkshop(assignment:WorkshopAssignment,windows:WorkshopWindowMeasurement[]):WorkshopEvaluationReport{
  if(!windows.length)throw new Error('No workshop measurement windows');const attemptId=windows[0]!.attemptId;const reasons:string[]=[];const indexes=new Set<number>(),allocations=new Set<string>();let previousEnd:number|undefined;
  for(const window of windows){if(window.attemptId!==attemptId||window.interval!=='(startTick,endTick]'||window.endTick-window.startTick!==assignment.throughput[0]?.windowTicks||indexes.has(window.index)||previousEnd!==undefined&&window.startTick!==previousEnd)reasons.push('window_boundary_invalid');indexes.add(window.index);previousEnd=window.endTick;if(!window.connected)reasons.push('measurement_disconnected');if(!window.mutationsFrozen)reasons.push('mutations_not_frozen');if(window.stageCoverage!=='complete')reasons.push('stage_coverage_incomplete');if(window.energyCoverage!=='complete')reasons.push('energy_coverage_incomplete');if(window.contamination.length)reasons.push('measurement_contaminated');for(const port of window.ports){const key=`${window.index}:${port.productionAllocationId}`;if(allocations.has(key))reasons.push('duplicate_production_allocation');allocations.add(key);}}
  if(windows.length!==Math.max(...assignment.throughput.map(t=>t.windows)))reasons.push('window_count_incomplete');const ports=assignment.throughput.map(rule=>evaluatePort(rule,assignment,windows));if(ports.some(port=>port.windows.some(window=>window.reasons.includes('port_coverage_incomplete'))))reasons.push('port_coverage_incomplete');if(ports.some(port=>port.windows.some(window=>!window.passed)))reasons.push('sustained_target_failed');const unique=[...new Set(reasons)];return{schema:1,attemptId,valid:unique.every(r=>r==='sustained_target_failed'),passed:unique.length===0, reasons:unique,ports,evidence:[...new Set(windows.flatMap(w=>[...w.evidence,...w.ports.flatMap(p=>p.evidence)]))]};
}
