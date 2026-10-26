import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Content-Type':'application/json'};
const clean=(s:string)=>s.replace(/<[^>]*>/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;|&#039;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
async function page(url:string){const r=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('SOURCE_UNAVAILABLE');return await r.text();}
export async function loadNews(province:string){
 if(['NA','SA','CE','AV','BN'].includes(province)){
  try{
   const html=await page('https://www.regione.campania.it/regione-informa/notizie');
   for(const match of html.matchAll(/<article\b[\s\S]*?<\/article>/g)){
    const article=match[0];if(!/aree-tematiche\/[^"<>]*sanit|>\s*Sanità\s*</i.test(article))continue;
    const heading=article.match(/<h5\b[^>]*>([\s\S]*?)<\/h5>/)?.[1]||'';
    const href=heading.match(/href="([^"]+)"/)?.[1],title=clean(heading),date=article.match(/<time\b[^>]*datetime="([^"]+)"/)?.[1];
    if(!href||!title||!date)continue;const url=new URL(href,'https://www.regione.campania.it');if(url.hostname!=='www.regione.campania.it'||!url.pathname.startsWith('/regione-informa/notizie/'))continue;
    const summary=clean(article.match(/<p\b[^>]*>([\s\S]*?)<\/p>/)?.[1]||'');
    return {title,url:url.href,source:'Regione Campania',publishedAt:date,summary:summary.slice(0,420),scope:'Campania'};
   }
  }catch{/* Fall back to an official national bulletin. */}
 }
 const year=new Date().getUTCFullYear();
 const html=await page(`https://www.epicentro.iss.it/archivio/archivio${String(year).slice(-2)}`);
 const match=html.match(/<h5>Numero del (\d{1,2})-(\d{1,2})-(\d{4})<\/h5>\s*<a\b[^>]*href="([^"]+)"[^>]*>\s*<ul>([\s\S]*?)<\/ul>/);
 if(!match)throw Error('NO_VERIFIED_ARTICLE');
 const topics=[...match[5].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(x=>clean(x[1]));
 const url=new URL(match[4],'https://www.epicentro.iss.it/archivio/');if(url.hostname!=='www.epicentro.iss.it'||!topics[0])throw Error('INVALID_SOURCE');
 return {title:topics[0],url:url.href,source:'EpiCentro · Istituto Superiore di Sanità',publishedAt:`${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`,summary:topics.slice(1,3).join(' · ').slice(0,420),scope:'Italia'};
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(!['GET','POST'].includes(req.method))return new Response(JSON.stringify({error:'METHOD_NOT_ALLOWED'}),{status:405,headers});
 try{let province=new URL(req.url).searchParams.get('province')||'';if(req.method==='POST'){const body=await req.json();province=String(body.province||'');}
 const item=await loadNews(province.toUpperCase().slice(0,2));return new Response(JSON.stringify({item,checkedAt:new Date().toISOString()}),{headers:{...headers,'Cache-Control':'public, max-age=21600'}});
 }catch{return new Response(JSON.stringify({error:'NEWS_UNAVAILABLE'}),{status:503,headers});}
});
