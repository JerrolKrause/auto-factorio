import { describe, expect, it } from 'vitest';
import { combineEffectReceipts, effectReceipt, normalizeEffectReceipt } from '@autofactorio/contracts';
import { buildEffectiveLearningBundle, learningBundleHash } from '../packages/core/workshop/learning.js';
import { emptyInferenceUsage, WorkshopInferenceAdmissions } from '../packages/core/workshop/usage.js';

describe('external effect receipts',()=>{
  it('accepts only exact terminal receipts and fails closed on missing, mismatched or contradictory values',()=>{
    expect(normalizeEffectReceipt(effectReceipt('provider:1','cancelled'),'provider:1','provider')).toMatchObject({outcome:'cancelled',failures:[]});
    expect(normalizeEffectReceipt(undefined,'provider:1','provider')).toMatchObject({outcome:'unknown',failures:['provider:missing_receipt']});
    expect(normalizeEffectReceipt(effectReceipt('provider:2','cancelled'),'provider:1','provider')).toMatchObject({outcome:'unknown',failures:['provider:malformed_receipt']});
    expect(normalizeEffectReceipt({schema:1,effectId:'provider:1',outcome:'cancelled',failures:['late effect']},'provider:1','provider')).toMatchObject({outcome:'unknown',failures:['provider:contradictory_receipt','late effect']});
  });
  it('keeps an aggregate unknown when any child effect is unknown',()=>{
    expect(combineEffectReceipts('workshop:1',[effectReceipt('provider:1','cancelled'),effectReceipt('game:1','completed')])).toMatchObject({outcome:'cancelled',failures:[]});
    expect(combineEffectReceipts('workshop:1',[effectReceipt('provider:1','cancelled'),{schema:1,effectId:'game:1',outcome:'unknown',failures:['no receipt']}])).toMatchObject({outcome:'unknown',failures:['no receipt']});
    expect(combineEffectReceipts('workshop:1',[{schema:1,effectId:'game:1',outcome:'unknown',failures:[]}])).toMatchObject({outcome:'unknown',failures:['game:1:unconfirmed_receipt']});
    expect(combineEffectReceipts('workshop:1',[{schema:1,effectId:'game:1',outcome:'completed',failures:['late failure']}])).toMatchObject({outcome:'unknown',failures:['game:1:contradictory_receipt','late failure']});
  });
});

describe('canonical learning bundles',()=>{
  it('overlays the incumbent once and hashes the complete effective files and cumulative controls',()=>{
    const incumbent=buildEffectiveLearningBundle({incumbentHash:'baseline',expectedGeneration:0,files:{'designer.instructions':'keep ports clear'},requiredControls:['base'],policyHash:'p1',retrievalHash:'r1',catalogHash:'c1',candidates:['one']},null,1024);
    const next=buildEffectiveLearningBundle({incumbentHash:learningBundleHash(incumbent),expectedGeneration:1,files:{'lessons.json':'[]'},requiredControls:['new','base'],policyHash:'p2',retrievalHash:'r2',catalogHash:'c2',candidates:['two','two']},incumbent,1024);
    expect(next).toMatchObject({files:{'designer.instructions':'keep ports clear','lessons.json':'[]'},requiredControls:['base','new'],behaviorChanging:true,candidates:['two']});
    expect(learningBundleHash(next)).toBe(learningBundleHash(structuredClone(next)));
  });
});

describe('aggregate workshop inference admission',()=>{
  it('partitions every finite unit, rejects identity reuse and closes finite tokens after unknown usage',()=>{
    const state=emptyInferenceUsage(),owner=new WorkshopInferenceAdmissions('session',{wallMs:60000,turns:6,toolCalls:12,reportedTokens:1200,learningReservedTurns:2,learningReservedTools:4},state);
    const workshop=owner.admit('workshop','workshop-designer','session:1:designer');expect(workshop.limits).toEqual({turns:1,tools:8,wallMs:40000,tokens:800});owner.complete(workshop,{turns:1,tools:2,elapsedMs:100,tokens:200},'done');
    expect(()=>owner.admit('workshop','workshop-designer','session:1:designer')).toThrow('already admitted');
    const learning=owner.admit('learning','workshop-learnings','session:learning');expect(learning.limits).toEqual({turns:1,tools:4,wallMs:20000,tokens:400});owner.unknown(learning,50);expect(()=>owner.admit('learning','workshop-learnings','session:learning-2')).toThrow('usage unknown');
  });
});
