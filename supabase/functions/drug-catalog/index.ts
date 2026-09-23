import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";

const URLS=[
  "https://www.aifa.gov.it/documents/20142/3815901/Classe_A_per_nome_commerciale_30-04-2026.csv",
  "https://www.aifa.gov.it/documents/20142/3815901/Classe_H_per_nome_commerciale_30-04-2026.csv"
];
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS"};
let catalog: {items:Record<string,string>[],loaded:number,errors:string[]} | null=null;
function reply(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}})}
function rows(csv:string):string[][]{
  const out:string[][]=[];let row:string[]=[],field="",quoted=false;
  csv=csv.replace(/^\uFEFF/,"");
  for(let i=0;i<csv.length;i++){
    const c=csv[i];
    if(c==='"' && quoted && csv[i+1]==='"'){field+='"';i++;continue}
    if(c==='"'){quoted=!quoted;continue}
    if(!quoted && (c===';'||c===',')){
      // The published AIFA CSV uses semicolons. Commas remain part of the field.
      if(c===';'){row.push(field.trim());field="";continue}
    }
    if(!quoted && (c==='\n'||c==='\r')){
      if(c==='\r' && csv[i+1]==='\n')i++;
      row.push(field.trim());field="";
      if(row.some(Boolean))out.push(row);row=[];continue;
    }
    field+=c;
  }
  if(field||row.length){row.push(field.trim());out.push(row)}
  return out;
}
const norm=(s:string)=>s.toLocaleLowerCase("it-IT").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
async function load(){
  if(catalog && Date.now()-catalog.loaded<24*3600*1000)return catalog;
  const all:Record<string,string>[]=[];const errors:string[]=[];
  for(const url of URLS){
    try{
      const res=await fetch(url,{headers:{"Accept":"text/csv,*/*"}});
      if(!res.ok)throw Error("HTTP "+res.status);
      const parsed=rows(await res.text());
      const keys=(parsed.shift()||[]).map(s=>norm(s).replace(/[^a-z0-9]/g,""));
      const find=(...patterns:string[])=>keys.findIndex(k=>patterns.some(p=>k.includes(p)));
      const aic=find("codiceaic","aic"),name=find("denominazioneeconfezione","denominazione","nomecommerciale"),active=find("principioattivo");
      const company=find("ditta","titolare"),form=find("forma");
      if(name<0||aic<0)throw Error("Intestazioni non riconosciute: "+keys.slice(0,8).join(","));
      for(const row of parsed){
        const item={name:row[name]||"",aic:row[aic]||"",active:active>=0?row[active]||"":"",company:company>=0?row[company]||"":"",form:form>=0?row[form]||"":"",pack:row[name]||"",source:url};
        if(item.name&&item.aic)all.push(item);
      }
    }catch(e){errors.push(url+": "+(e instanceof Error?e.message:String(e)))}
  }
  catalog={items:all,loaded:Date.now(),errors};
  return catalog;
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:CORS});
  if(req.method!=="GET")return reply({error:"METHOD_NOT_ALLOWED"},405);
  const u=new URL(req.url);
  // Public source status contains no patient or user data.
  if(u.searchParams.has("catalog_health")){
    const c=await load();
    return reply({count:c.items.length,errors:c.errors,source_urls:URLS});
  }
  try{
    const jwt=(req.headers.get("authorization")||"").replace(/^Bearer /,"");
    if(!jwt) return reply({error:"AUTH_REQUIRED"},401);
    const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const {data,error}=await admin.auth.getUser(jwt);
    if(error||!data.user)return reply({error:"INVALID_SESSION"},401);
    const q=norm((u.searchParams.get("q")||"").trim());
    if(q.length<2)return reply({items:[]});
    const c=await load();
    if(!c.items.length)return reply({error:"Catalogo AIFA temporaneamente non disponibile",details:c.errors},503);
    const items=c.items.filter(x=>norm(x.name+" "+x.active+" "+x.aic).includes(q)).slice(0,25);
    return reply({items,source:"AIFA · elenchi classe A e H",source_urls:URLS,as_of:"2026-04-30",queried_at:new Date().toISOString()});
  }catch(e){return reply({error:e instanceof Error?e.message:String(e)},500)}
});
