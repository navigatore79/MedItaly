import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
import {validateManifest, canonical, sha256, readJson} from './validation.ts';
import {processorConfig,processorReady,dispatch} from './processor.ts';

const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
// Machine-to-machine endpoint: no CORS, no patient identifiers in URLs or logs.
Deno.serve(async req=>{
 if(req.method!=='POST')return reply({error:'POST_REQUIRED'},405);
 try{
  const key=req.headers.get('x-medi-source-key')||'';
  if(!/^medi_[0-9a-f]{64}$/.test(key))return reply({error:'UNAUTHORIZED'},401);
  const {data:source,error:sourceError}=await db.from('imaging_sources').select('id,center_id').eq('key_hash',await sha256(key)).eq('active',true).maybeSingle();
  if(sourceError)throw sourceError;
  if(!source)return reply({error:'UNAUTHORIZED'},401);
  const body=await readJson(req,65536);
  if(body.action==='create'){
   const config=await processorConfig(db);
   if(!await processorReady(config))return reply({error:'PROCESSOR_OFFLINE'},503);
   const manifest=validateManifest(body.manifest), digest=await sha256(canonical(manifest));
   let {data:delivery,error}=await db.from('imaging_deliveries').select('id,status,manifest_hash').eq('source_id',source.id).eq('request_id',manifest.request_id).maybeSingle();
   if(error)throw error;
   if(!delivery){
    const {count,error:quotaError}=await db.from('imaging_deliveries').select('id',{count:'exact',head:true}).eq('source_id',source.id).gte('created_at',new Date(Date.now()-3600000).toISOString());
    if(quotaError)throw quotaError;
    if((count||0)>=30)return reply({error:'HOURLY_QUOTA'},429);
    const inserted=await db.from('imaging_deliveries').insert({source_id:source.id,center_id:source.center_id,request_id:manifest.request_id,manifest,manifest_hash:digest}).select('id,status,manifest_hash').single();
    if(inserted.error?.code==='23505'){
     const existing=await db.from('imaging_deliveries').select('id,status,manifest_hash').eq('source_id',source.id).eq('request_id',manifest.request_id).single();
     if(existing.error)throw existing.error;delivery=existing.data;
    }else{if(inserted.error)throw inserted.error;delivery=inserted.data;}
   }
   if(delivery!.manifest_hash!==digest)return reply({error:'IDEMPOTENCY_CONFLICT'},409);
   const uploads=[];
   if(delivery!.status==='uploading')for(let i=0;i<manifest.files.length;i++){
    const path=`${delivery!.id}/${i}`;
    const {data,error}=await db.storage.from('imaging-incoming').createSignedUploadUrl(path,{upsert:false});
    if(error)throw error;
    uploads.push({index:i,path,url:data.signedUrl,content_type:'application/octet-stream'});
   }
   return reply({id:delivery!.id,status:delivery!.status,uploads});
  }
  if(!/^[0-9a-f-]{36}$/.test(body.id||''))return reply({error:'INVALID_ID'},400);
  const {data:d,error}=await db.from('imaging_deliveries').select('id,status,manifest,reason,lease_until').eq('id',body.id).eq('source_id',source.id).maybeSingle();
  if(error)throw error;if(!d)return reply({error:'NOT_FOUND'},404);
  if(body.action==='status'){
   if(d.status==='queued'||(d.status==='processing'&&Date.parse(d.lease_until)<Date.now())){const config=await processorConfig(db);if(config)EdgeRuntime.waitUntil(dispatch(config,d.id));}
   return reply({id:d.id,status:d.status,reason:d.reason});
  }
  if(body.action!=='complete')return reply({error:'INVALID_ACTION'},400);
  if(d.status!=='uploading')return reply({id:d.id,status:d.status});
  const listed=await db.storage.from('imaging-incoming').list(d.id,{limit:100});if(listed.error)throw listed.error;
  for(let i=0;i<d.manifest.files.length;i++){
   const object=listed.data.find(x=>x.name===String(i));
   if(!object||Number(object.metadata?.size)!==d.manifest.files[i].bytes)return reply({error:'UPLOAD_INCOMPLETE',index:i},409);
  }
  const updated=await db.from('imaging_deliveries').update({status:'queued'}).eq('id',d.id).eq('status','uploading');if(updated.error)throw updated.error;
  const config=await processorConfig(db);if(config)EdgeRuntime.waitUntil(dispatch(config,d.id));
  return reply({id:d.id,status:'queued'},202);
 }catch(e){
  if(e instanceof TypeError)return reply({error:e.message},400);
  // Never return raw database errors or log bodies, keys, or patient metadata.
  return reply({error:'TEMPORARILY_UNAVAILABLE'},503);
 }
});
