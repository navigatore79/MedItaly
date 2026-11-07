import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
import {readJson,sha256} from '../imaging-ingest/validation.ts';
import {processorConfig} from '../imaging-ingest/processor.ts';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const uuid=(x:unknown)=>typeof x==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(x);
Deno.serve(async req=>{
 if(req.method!=='POST')return reply({error:'POST_REQUIRED'},405);
 try{
  const cfg=await processorConfig(db), supplied=req.headers.get('authorization')||'';
  // Hash both sides before comparison: fixed-size secret comparison, no plaintext timing prefix.
  if(!cfg||await sha256(supplied)!==await sha256('Bearer '+cfg.secret))return reply({error:'UNAUTHORIZED'},401);
  const body=await readJson(req,1048576);if(!uuid(body.id))return reply({error:'INVALID_ID'},400);
  if(body.action==='claim'){
   const r=await db.rpc('imaging_claim_delivery',{p_delivery:body.id});if(r.error)throw r.error;if(!r.data)return reply({job:null});
   const job=r.data,urls=[];
   for(let i=0;i<job.manifest.files.length;i++){const s=await db.storage.from('imaging-incoming').createSignedUrl(job.id+'/'+i,480);if(s.error)throw s.error;urls.push(s.data.signedUrl);}
   return reply({job:{id:job.id,manifest:job.manifest,lease_token:job.lease_token,input_urls:urls}});
  }
  if(!uuid(body.lease))return reply({error:'INVALID_LEASE'},400);
  const r=await db.from('imaging_deliveries').select('id,status,lease_token,lease_until,source_id').eq('id',body.id).maybeSingle();if(r.error)throw r.error;
  const d=r.data;if(!d||d.status!=='processing'||d.lease_token!==body.lease||Date.parse(d.lease_until)<Date.now())return reply({error:'INVALID_LEASE'},409);
  const src=await db.from('imaging_sources').select('active').eq('id',d.source_id).single();if(src.error)throw src.error;if(!src.data.active)return reply({error:'SOURCE_REVOKED'},403);
  if(body.action==='prepare_asset'){
   if(!['report','dicom'].includes(body.kind)||!/^[a-f0-9]{64}$/.test(body.sha256)||!Number.isSafeInteger(body.bytes)||body.bytes<1||body.bytes>64*1048576)return reply({error:'INVALID_ASSET'},400);
   const path=d.id+'/'+body.sha256,upload=await db.storage.from('imaging-clinical').createSignedUploadUrl(path,{upsert:false});if(upload.error)throw upload.error;
   return reply({path,url:upload.data.signedUrl});
  }
  if(body.action!=='complete')return reply({error:'INVALID_ACTION'},400);
  if(!Array.isArray(body.assets)||body.assets.length>1000||typeof body.validation?.ok!=='boolean')return reply({error:'INVALID_RESULT'},400);
  if(body.validation.ok){
   // Check storage existence and actual uploaded sizes before any publication transaction.
   const stored=await db.storage.from('imaging-clinical').list(d.id,{limit:1000});if(stored.error)throw stored.error;
   for(const a of body.assets){if(a.path!==d.id+'/'+a.sha256||!/^[a-f0-9]{64}$/.test(a.sha256)||!['report','dicom'].includes(a.kind)||!Number.isSafeInteger(a.bytes)||a.bytes<1)return reply({error:'INVALID_ASSET'},400);const object=stored.data.find(x=>x.name===a.sha256);if(!object||Number(object.metadata?.size)!==a.bytes)return reply({error:'ASSET_NOT_UPLOADED'},409);}
  }
  const done=await db.rpc('imaging_complete',{p_delivery:d.id,p_lease:body.lease,p_validation:body.validation,p_assets:body.assets});if(done.error)throw done.error;
  return reply({status:done.data});
 }catch(e){return reply({error:e instanceof TypeError?e.message:'PROCESSING_UNAVAILABLE'},e instanceof TypeError?400:503);}
});
