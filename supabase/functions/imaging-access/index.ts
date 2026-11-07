import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
Deno.serve(async req=>{
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return reply({error:'POST_REQUIRED'},405);
 try{
  const user=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:req.headers.get('authorization')||''}},auth:{persistSession:false}});
  const auth=await user.auth.getUser();if(auth.error||!auth.data.user)return reply({error:'UNAUTHORIZED'},401);
  const body=await req.json();
  const access=await user.rpc('imaging_access',{p_delivery:body.id});if(access.error)return reply({error:'NOT_FOUND_OR_FORBIDDEN'},403);
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const assets=[];
  for(const asset of access.data.assets){const signed=await admin.storage.from('imaging-clinical').createSignedUrl(asset.path,60);if(signed.error)throw signed.error;assets.push({...asset,url:signed.data.signedUrl});}
  return reply({id:body.id,assets});
 }catch{return reply({error:'TEMPORARILY_UNAVAILABLE'},503);}
});
