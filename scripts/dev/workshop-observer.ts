import { record } from '@autofactorio/contracts';
import { ensureVisibleObserver } from '../game-observer.js';
import { observeRequest } from '../../packages/factorio/src/client.js';
import type { GameClient } from '../../packages/factorio/src/client.js';
import { observerInGame, stopProfile, waitFor } from './game-processes.js';
import type { GameProfile } from './game-processes.js';

/** Recheck every run; serialize launch attempts and clean up only clients we start. */
export function workshopObserver(profile:GameProfile,game:GameClient,onOwned:()=>void=()=>{}){
  let pending:Promise<void>|null=null,owned=false,closing=false;
  return{
    ensure():Promise<void>{
      if(closing)return Promise.reject(new Error('Factorio client manager is shutting down'));
      if(pending)return pending;
      pending=ensureVisibleObserver(profile,async()=>{
        await waitFor('Visible AutoFactorio builder',async()=>{
          if(closing)throw new Error('Factorio client manager is shutting down');
          if(!await observerInGame(profile))return undefined;
          const world=await game.request(observeRequest);
          return record(record(world.actors??{})['builder-1']??{}).connected===true?true:undefined;
        },180000,500);
      },undefined,()=>{owned=true;onOwned();},()=>!closing).then(()=>{}).finally(()=>{pending=null;});
      return pending;
    },
    async close():Promise<void>{
      closing=true;
      try{await pending;}catch{/* Failed startup already cleaned up its client. */}
      if(owned)await stopProfile(profile.observerConfig);
    },
  };
}
