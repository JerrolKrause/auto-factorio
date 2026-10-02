import { useRef, useState } from 'react';

/** UI feedback owns no execution state. Scope changes retire only response presentation. */
export function useAsyncActions(scope: string) {
  const generation=useRef({scope,locks:new Set<string>()});
  if(generation.current.scope!==scope)generation.current={scope,locks:new Set<string>()};
  const [state,setState]=useState<{generation:typeof generation.current;pending:string[];message:string;error:string}>();
  const visible=state?.generation===generation.current?state:undefined;
  async function run(key:string,label:string,work:(current:()=>boolean)=>Promise<void>,success:string) {
    const token=generation.current;
    if(token.locks.has(key))return;
    token.locks.add(key);
    const current=()=>generation.current===token;
    const publish=(message:string,error='')=>{if(current())setState({generation:token,pending:[...token.locks],message,error});};
    publish(label);
    try{await work(current);publish(success);}
    catch(error){publish('',`${label.replace(/…$/,'')} failed: ${String(error)}. Retry the action.`);}
    finally{token.locks.delete(key);if(current())setState(previous=>previous?.generation===token?{...previous,pending:[...token.locks]}:previous);}
  }
  return{run,pending:(key:string)=>visible?.pending.includes(key)??false,message:visible?.message??'',error:visible?.error??''};
}

export function AsyncFeedback({actions}:{actions:{message:string;error:string}}) {
  return <>{actions.message&&<p className="notice" role="status" aria-live="polite">{actions.message}</p>}{actions.error&&<p className="alert" role="alert">{actions.error}</p>}</>;
}
