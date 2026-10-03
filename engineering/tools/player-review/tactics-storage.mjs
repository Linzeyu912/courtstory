// Trajectory snapshots exceed localStorage's per-origin quota on real clips.
let database;
function open(){
  if(!database)database=new Promise((resolve,reject)=>{
    const request=indexedDB.open('court-tactical-drafts',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{database=null;reject(request.error);};
  });
  return database;
}
export async function writeTacticsDraft(key,value){
  const db=await open();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('drafts','readwrite');
    transaction.objectStore('drafts').put(value,key);
    transaction.oncomplete=()=>resolve();
    transaction.onerror=transaction.onabort=()=>reject(transaction.error||new Error('浏览器草稿写入失败。'));
  });
}
export async function readTacticsDraft(key){
  const db=await open();
  const result=await new Promise((resolve,reject)=>{
    const request=db.transaction('drafts','readonly').objectStore('drafts').get(key);
    request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);
  });
  if(result)return result;
  const legacy=localStorage.getItem(key);
  if(!legacy)return null;
  const value=JSON.parse(legacy);await writeTacticsDraft(key,value);
  // Only remove the exact migrated key after the IndexedDB transaction commits.
  localStorage.removeItem(key);return value;
}
export async function migrateLegacyTacticsDrafts(){
  const keys=Object.keys(localStorage).filter(key=>key.startsWith('player-review:')&&key.includes(':tactics:'));
  for(const key of keys){
    const raw=localStorage.getItem(key);if(!raw)continue;
    const value=JSON.parse(raw);if(value?.document?.schemaVersion!==1)continue;
    await readTacticsDraft(key);
    // Preserve an older copy too if this browser already has an IndexedDB draft.
    if(localStorage.getItem(key)!==null){await writeTacticsDraft(`${key}:legacy-recovery`,value);localStorage.removeItem(key);}
  }
}
