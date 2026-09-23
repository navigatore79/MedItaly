import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const SOURCE="https://www.trovanorme.salute.gov.it/norme/renderPdf.spring?seriegu=SG&datagu=18/03/2017&redaz=17A02015&artp=4&art=1&subart=1&subart1=10&vers=1&prog=001";
Deno.serve(async req=>{
 if(req.method!=="GET")return new Response("Method not allowed",{status:405});
 const r=await fetch(SOURCE);
 if(!r.ok)return new Response("Ministero: HTTP "+r.status,{status:502});
 const bytes=await r.arrayBuffer();
 if(bytes.byteLength>15000000)return new Response("File too large",{status:502});
 return new Response(bytes,{headers:{"Content-Type":"application/pdf","Cache-Control":"public, max-age=86400","Content-Disposition":"inline; filename=allegato-4-nomenclatore.pdf"}});
});