import { describe, expect, it } from 'vitest';
import { clearWorkshopDraft, readWorkshopDraft, saveWorkshopDraft, WORKSHOP_DRAFT_KEY } from '../apps/dashboard/src/workshop-draft.js';
import type { WorkshopDraftValues } from '../apps/dashboard/src/workshop-draft.js';

const values: WorkshopDraftValues = { objective:'Build gears',profile:'starter-assembly',construction:'character',libraryAccess:false,
  attempts:2,earlyStop:false,checkpoints:{brief:true,afterScore:false,libraryAdmission:true,learningActivation:false},
  model:'gpt-6-astra',effort:'low',designerModel:'',designerEffort:'',scorerModel:'',scorerEffort:'',learningsModel:'',learningsEffort:'',
  speed:'10',settling:600,windowTicks:3600,windows:5,wallMinutes:60,turns:30,toolCalls:200,learningCadence:'off',learningBatch:5,
  learningCandidates:3,learningAttempts:2,learningTurns:3,autoActivate:false,improveRevision:null,selectedGroupId:'brief-1' };

describe('local workshop setup draft',()=>{
  it('restores every saved field and clears deliberately',()=>{let stored:string|null=null;const storage={getItem:()=>stored,setItem:(_key:string,value:string)=>{stored=value;},removeItem:()=>{stored=null;}};
    expect(saveWorkshopDraft(storage,values)).toBeNull();expect(readWorkshopDraft(storage).values).toEqual(values);
    expect(clearWorkshopDraft(storage)).toBeNull();expect(readWorkshopDraft(storage).values).toBeNull();});
  it('does not overwrite invalid versions or failed storage',()=>{const invalid={getItem:()=>JSON.stringify({schema:2,values}),setItem:()=>{throw new Error('must not write');},removeItem:()=>{throw new Error('denied');}};
    expect(readWorkshopDraft(invalid)).toMatchObject({values:null,writable:false,message:expect.stringContaining('unsupported version')});
    const damaged={getItem:()=>JSON.stringify({schema:1,values:{...values,checkpoints:{brief:true},windowTicks:'3600'}}),setItem:()=>{},removeItem:()=>{}};
    expect(readWorkshopDraft(damaged)).toMatchObject({values:null,writable:false,message:expect.stringContaining('damaged')});
    expect(clearWorkshopDraft(invalid)).toContain('denied');
    expect(saveWorkshopDraft(invalid,values)).toContain('must not write');
    expect(readWorkshopDraft({getItem:()=>{throw new Error('blocked');},setItem:()=>{},removeItem:()=>{}})).toMatchObject({values:null,writable:true,message:expect.stringContaining('memory')});
    expect(WORKSHOP_DRAFT_KEY).toContain('.v1');});
});
