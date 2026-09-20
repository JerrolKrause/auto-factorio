import path from 'node:path';
import type { ModelSelection } from '@autofactorio/contracts';
import type { DurableRuntime } from './durable-runtime.js';
import { WorkshopOrchestrator } from '../../packages/core/workshop/orchestrator.js';
import type { WorkshopSessionState } from '../../packages/core/workshop/orchestrator.js';
import { LearningService } from '../../packages/core/workshop/learning.js';
import { BlueprintLibrary } from '../../packages/core/workshop/library.js';
import { WorkshopRuntime } from '../../packages/core/workshop/runtime.js';
import type { WorkshopRuntimeHost } from '../../packages/core/workshop/runtime.js';
import { WorkshopUsageLedger } from '../../packages/core/workshop/usage.js';

export interface WorkshopCompositionOptions {
  managedModels?: { id:string; displayName:string|null; efforts:string[] }[];
  workshopBundleHash?:string;
  workshopHost?:WorkshopRuntimeHost&{close?:()=>void|Promise<void>};
}

/** The one production composition root used by the dashboard and composition acceptance tests. */
export function composeWorkshop(runtime:Pick<DurableRuntime,'directory'|'run'|'journal'|'context'|'record'>,options:WorkshopCompositionOptions={}){
  const orchestrator=new WorkshopOrchestrator(runtime.journal,()=>runtime.context());
  const learning=new LearningService(runtime.journal,()=>runtime.context());
  const usage=new WorkshopUsageLedger(runtime.journal,()=>runtime.context());
  const library=new BlueprintLibrary(path.join(runtime.directory,'blueprint-library'));
  const available=():ModelSelection[]=>(options.managedModels??[]).flatMap(model=>model.efforts.map(reasoningEffort=>({provider:'openai',modelId:model.id,reasoningEffort})));
  const sessions=()=>runtime.journal.list<WorkshopSessionState>(runtime.run,'workshopSessions');
  options.workshopHost?.bindServices?.({library,learning,usage,sessions});
  const controller=options.workshopHost?new WorkshopRuntime(orchestrator,options.workshopHost,library,available,id=>options.workshopBundleHash??learning.pin(id).hash,sessions,entry=>{const publicEntry={...entry} as Partial<typeof entry>;delete publicEntry.directory;runtime.record('workshop/library-admitted',[{entity:'libraryEntries',id:entry.revisionHash,value:{...publicEntry}}]);}):null;
  controller?.recover();
  return{orchestrator,learning,usage,library,controller,available,sessions};
}
