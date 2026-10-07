const THROTTLE_ERROR=/Throttling\.(?:RateQuota|AllocationQuota|BurstRate)/i;
const TERMINAL_ERROR=/\b(?:401|403|402)\b|unauthori[sz]ed|authentication|invalid api[ -]?key|insufficient[ _-]?quota|credit(?:s)?[ _-]?(?:exhausted|insufficient|depleted)|billing|payment required|欠费|余额不足|额度不足/i;
const TRANSIENT_ERROR=/\b(?:408|425|429|5\d\d)\b|timeout|timed out|network|connection error|fetch failed|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UND_ERR_|Throttling\.(?:RateQuota|AllocationQuota|BurstRate)/i;

export function isTransientRequestError(error){
  if(error&&typeof error==='object'&&[401,402,403].includes(Number(error.status)))return false;
  const text=String(error?.message??error??'');
  if(THROTTLE_ERROR.test(text))return true;
  if(TERMINAL_ERROR.test(text))return false;
  if(error&&typeof error==='object'&&Number(error.status)>=500&&Number(error.status)<=599)return true;
  return TRANSIENT_ERROR.test(text);
}

export function removeInterruptedAssistantMessages(messages){
  return messages.filter(message=>!(message.role==='assistant'&&['error','aborted'].includes(message.stopReason)));
}

export async function promptWithReconnect(agent,initialPrompt,{
  getLastError,clearLastError,shouldStop=()=>false,onReconnect=async()=>{},
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  makeRecoveryPrompt=({attempt})=>`网络短暂中断（恢复 ${attempt}）。请基于已有对话和工具结果继续，不要重放已成功完成的调用。`,
  maxReconnects=2,
}={}){
  let prompt=initialPrompt,retries=0;
  while(true){
    clearLastError?.();
    await agent.prompt(prompt);
    const error=getLastError?.();
    if(!error||!isTransientRequestError(error)||retries>=maxReconnects||shouldStop())return {retries,error:error??null};
    retries++;
    const delayMs=1000*2**(retries-1);
    agent.state.messages=removeInterruptedAssistantMessages(agent.state.messages);
    await onReconnect({attempt:retries,error,delayMs});
    if(shouldStop())return {retries,error,stopped:true};
    await sleep(delayMs);
    if(shouldStop())return {retries,error,stopped:true};
    prompt=makeRecoveryPrompt({attempt:retries,error});
  }
}
