import { describe, expect, it } from 'vitest';
import { clearPendingWorkshop, readPendingWorkshop, savePendingWorkshop } from '../apps/dashboard/src/workshop-request.js';

describe('browser launch request identity',()=>{
  it('retains exact payload and ID across response loss',()=>{let raw:string|null=null;const store={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value;},removeItem:()=>{raw=null;}};
    const request={schema:1 as const,id:'same-id',assignment:{id:'same-id',comparisonSeries:'fixed-series',objective:'Make circuits'},selectedGroupId:'brief',createdAt:new Date().toISOString()};
    expect(savePendingWorkshop(store,request)).toBeNull();expect(readPendingWorkshop(store)).toEqual(request);
    expect(clearPendingWorkshop(store)).toBeNull();expect(readPendingWorkshop(store)).toBeNull();});
});
