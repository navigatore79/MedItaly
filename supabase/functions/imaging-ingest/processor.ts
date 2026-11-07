export async function processorConfig(db:any){const r=await db.rpc('imaging_processor_config');if(r.error)throw r.error;return r.data;}
export async function processorReady(config:any){
 if(!config)return false;
 try{const r=await fetch(config.url+'/health',{headers:{Authorization:'Bearer '+config.secret},signal:AbortSignal.timeout(130000)});return r.ok&&(await r.json()).ready===true;}catch{return false;}
}
export async function dispatch(config:any,id:string){
 if(!config)return;
 try{const r=await fetch(config.url,{method:'POST',headers:{Authorization:'Bearer '+config.secret,'Content-Type':'application/json'},body:JSON.stringify({id}),signal:AbortSignal.timeout(330000)});await r.body?.cancel();}catch{/* receipt and lease preserve progress for retry; never log patient data */}
}
