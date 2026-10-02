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
import type { WorkspaceCatalog } from '../../packages/storage/src/workspace-catalog.js';

export interface WorkshopCompositionOptions {
  managedModels?: { id:string; displayName:string|null; efforts:string[] }[];
  workshopBundleHash?:string;
  workshopHost?:WorkshopRuntimeHost&{close?:()=>void|Promise<void>};
  workspaceCatalog?:WorkspaceCatalog;
}

/** The one production composition root used by the dashboard and composition acceptance tests. */
export function composeWorkshop(runtime:Pick<DurableRuntime,'directory'|'run'|'journal'|'context'|'record'>,options:WorkshopCompositionOptions={}){
  const orchestrator=new WorkshopOrchestrator(runtime.journal,()=>runtime.context(),attempt=>options.workspaceCatalog?.recordAttempt(attempt));
  const learning=new LearningService(runtime.journal,()=>runtime.context());
  const usage=new WorkshopUsageLedger(runtime.journal,()=>runtime.context());
  const library=new BlueprintLibrary(path.join(runtime.directory,'blueprint-library'));
  const available=():ModelSelection[]=>(options.managedModels??[]).flatMap(model=>model.efforts.map(reasoningEffort=>({provider:'openai',modelId:model.id,reasoningEffort})));
  const sessions=()=>runtime.journal.list<WorkshopSessionState>(runtime.run,'workshopSessions');
  options.workshopHost?.bindServices?.({library,learning,usage,sessions});
  const history=options.workspaceCatalog?{
    admit:(id:string,input:unknown)=>options.workspaceCatalog!.admit(id,'workshop',input,runtime.directory),
    owns:(id:string)=>options.workspaceCatalog!.owns(id),
    transition:(id:string,state:import('../../packages/storage/src/workspace-catalog.js').WorkspaceRequest['state'],reason?:string|null)=>options.workspaceCatalog!.transitionRequest(id,state,reason),
    stopIntent:(id:string,reason:string)=>options.workspaceCatalog!.stopIntent(id,reason),
    stopRequested:(id:string)=>options.workspaceCatalog!.stopRequested(id),
    begin:(assignment:import('@autofactorio/contracts').WorkshopAssignment,selectedGroupId:string|null)=>options.workspaceCatalog!.beginWorkshop(runtime.directory,runtime.run,assignment,selectedGroupId),
    journaled:(id:string)=>options.workspaceCatalog!.journaled(id),
  }:undefined;
  const controller=options.workshopHost?new WorkshopRuntime(orchestrator,options.workshopHost,library,available,id=>options.workshopBundleHash??learning.pin(id).hash,sessions,entry=>{if(runtime.journal.get(runtime.run,'libraryEntries',entry.revisionHash))return;const publicEntry={...entry} as Partial<typeof entry>;delete publicEntry.directory;runtime.record('workshop/library-admitted',[{entity:'libraryEntries',id:entry.revisionHash,value:{...publicEntry}}]);},history):null;
  controller?.recover();
  return{orchestrator,learning,usage,library,controller,available,sessions};
}
