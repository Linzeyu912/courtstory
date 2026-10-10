// Only reads and explicitly idempotent saves may be repeated after a disconnect.
export async function requestJSON(url, options, {fetcher=globalThis.fetch, retry=false, delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const attempts=(!options?.method||options.method==='GET'||retry)?3:1;
  for(let attempt=0;attempt<attempts;attempt++){
    let response;
    try{response=await fetcher(url,options);}
    catch(error){
      if(attempt+1<attempts){await delay(400*(attempt+1));continue;}
      throw new Error('网络连接中断，草稿已保留。请检查连接后重试。', {cause:error});
    }
    if(response.status===401||response.redirected&&response.url?.includes('/login'))throw new Error('登录已失效，请在新标签页登录工作台，再返回此页重试；当前草稿保留。');
    if([502,503,504].includes(response.status)&&attempt+1<attempts){await delay(400*(attempt+1));continue;}
    let value;
    try{value=await response.json();}
    catch(error){
      if(response.ok&&attempt+1<attempts){await delay(400*(attempt+1));continue;}
      throw new Error(`服务响应不完整（${response.status??'网络中断'}），请稍后重试。`,{cause:error});
    }
    if(!response.ok){
      const message=value.error||value.message||`请求失败（${response.status}）`;
      const error=new Error({'commentary understanding credential is not configured':'视频理解服务未配置 OpenRouter 凭据，请在服务端配置后重试。',
        'speech credential is not configured':'配音服务未配置语音凭据，请在服务端配置后重试。'}[message]||message);
      error.status=response.status;throw error;
    }
    return value;
  }
}
