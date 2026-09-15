import { validateRequest } from '@autofactorio/contracts';
import type { GameRequest } from '@autofactorio/contracts';
import type { Role } from './gateway.js';
/** Constructed by authenticated runtime code, never by model arguments. */
export class GameTools {
  constructor(private role: Role, private actor: string, private dispatch: (r: GameRequest)=>Promise<unknown>) {}
  async call(input: unknown): Promise<unknown> {
    const r=validateRequest(input);
    if((r.op==='submit'||r.op==='cancel')&&this.role!=='engineer')throw new Error('Role cannot mutate the game');
    if(r.op==='submit'&&r.batch.actor!==this.actor)throw new Error('Actor is not assigned to this identity');
    return this.dispatch(r);
  }
}
