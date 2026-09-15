import { validateRequest, validateReceipt, record } from '@autofactorio/contracts';
import type { GameRequest, Receipt } from '@autofactorio/contracts';
import type { CommandPort } from './rcon.js';
import { wrapper } from './rcon.js';
export class GameClient {
  readonly unresolved = new Set<string>();
  admission = true;
  constructor(private port: CommandPort, private sink: (e: unknown)=>void) {}
  replacePort(port: CommandPort): void { this.port.close(); this.port=port; }
  async request(input: unknown): Promise<Record<string, unknown>> {
    const request=validateRequest(input);
    if(request.op==='submit'&&!this.admission)throw new Error('Game admission closed pending control reconciliation');
    if(request.op==='submit'&&this.unresolved.size)throw new Error('Unknown outcome requires receipt reconciliation');
    this.sink({at:new Date().toISOString(),kind:'game/request',request});
    let acknowledged=false;
    try {
      const response=record(JSON.parse(await this.port.command(wrapper(request))));
      this.sink({at:new Date().toISOString(),kind:'game/response',op:request.op,response});
      if(response.ok===false){acknowledged=true;throw new Error(String(response.error));}
      if(response.ok!==true)throw new Error('Malformed game response');
      if(['submit','receipt','cancel'].includes(request.op)){response.receipt=validateReceipt(response.receipt);if(response.receipt&&record(response.receipt).commandId!==(request.op==='submit'?request.batch.commandId:request.op==='receipt'||request.op==='cancel'?request.commandId:null))throw new Error('Receipt identity mismatch');}
      acknowledged=true;
      if(request.op==='receipt'&&response.receipt && record(response.receipt).status!=='unknown')this.unresolved.delete(request.commandId);
      return response;
    } catch(error) {
      if(request.op==='submit'&&!acknowledged)this.unresolved.add(request.batch.commandId);
      this.sink({at:new Date().toISOString(),kind:'game/unknownOrRejected',error:String(error),request});throw error;
    }
  }
  async receipt(commandId: string): Promise<Receipt | null> {const r=await this.request({op:'receipt',commandId});return r.receipt as Receipt|null;}
  close(): void {this.port.close();}
}
export const observeRequest: GameRequest = {op:'observe',surface:'nauvis',area:[{x:-32,y:-32},{x:32,y:32}],offset:0,limit:50};
