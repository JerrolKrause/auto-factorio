import { describe, expect, it } from 'vitest';
import { parseWorkshopChangePlan, parseWorkshopCritique } from '@autofactorio/contracts';

const refs={candidate:'artifact-1',evaluation:'run:1',rawHash:'raw-hash',failed:true};
const finding={id:'f-1',candidateRef:'artifact-1',evaluationRef:'run:1',observed:'Output missed the second window',impact:'Target not met',
  suspectedCause:'Assembler starved of copper cable',uncertainty:'Input telemetry is partial',recommendedChange:'Add a second cable assembler and belt feed',nextValidation:'Measure five fixed windows again'};

describe('evidence-linked workshop critique',()=>{
  it('links measured failure to a bounded next designer plan',()=>{const critique=parseWorkshopCritique({schema:1,summary:'Cable input bottleneck',findings:[finding]},refs);
    expect(critique).toMatchObject({status:'validated',findings:[{id:'f-1',candidateRef:'artifact-1',evaluationRef:'run:1'}]});
    expect(parseWorkshopChangePlan({schema:1,summary:'Add cable feed',findingIds:['f-1'],candidateRef:'artifact-1'},{candidateRef:'artifact-1',findingIds:['f-1']}))
      .toMatchObject({findingIds:['f-1']});
    expect(()=>parseWorkshopChangePlan({schema:1,summary:'Unlinked',findingIds:['other'],candidateRef:'artifact-1'},{candidateRef:'artifact-1',findingIds:['f-1']})).toThrow('link');});
  it('makes unsupported output and measurement gaps explicit without changing a score',()=>{expect(parseWorkshopCritique({feedback:'Looks fine'},refs)).toMatchObject({status:'unavailable',validation:'missing_version_summary_or_findings',findings:[{id:'evidence-gap'}]});
    expect(parseWorkshopCritique({schema:1,summary:'No change needed',findings:[]},{...refs,failed:false})).toMatchObject({status:'validated',findings:[]});
    expect(parseWorkshopCritique({schema:1,summary:'Bad link',findings:[{...finding,evaluationRef:'other'}]},refs).validation).toBe('unsupported_or_unlinked_finding');});
});
