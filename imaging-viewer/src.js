import {RenderingEngine,Enums,init as coreInit,cache} from '@cornerstonejs/core';
import {init as loaderInit,wadouri} from '@cornerstonejs/dicom-image-loader';
import dicomParser from 'dicom-parser';
import {Unzip,UnzipInflate} from 'fflate';
const uniqueId=()=>Array.from(crypto.getRandomValues(new Uint32Array(4)),x=>x.toString(16)).join('-');
let initialized;
const start=()=>initialized||=(async()=>{await coreInit();loaderInit({maxWebWorkers:2,useLegacyMetadataProvider:true});cache.setMaxCacheSize(96*1024*1024);})();

export async function openDicom(host,assets){
 await start();host.replaceChildren();
 const header=document.createElement('div'),series=document.createElement('select'),stage=document.createElement('div'),status=document.createElement('p');
 stage.style.cssText='width:100%;height:55vh;min-height:260px;background:#000;touch-action:none';
 series.setAttribute('aria-label','Serie dell’esame');header.append(series);host.append(header,stage,status);
 const engine=new RenderingEngine('medi-'+uniqueId());const id='study';
 engine.enableElement({viewportId:id,element:stage,type:Enums.ViewportType.STACK});const view=engine.getViewport(id);
 const groups=new Map();for(const a of assets){const uid=a.metadata.series_uid;if(!groups.has(uid))groups.set(uid,[]);groups.get(uid).push(a);} const frames=[];let active=[],cursor=0,generation=0,disposed=false,timer,defaultCamera;
 const loaded=new Map(),registered=[];let loading=false;
 for(const [uid,rows] of groups){const option=document.createElement('option');option.value=uid;option.textContent='Serie '+(series.options.length+1)+' · '+rows.length+' immagini';series.append(option);}
 const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='padding:12px;margin:4px;font:inherit';b.onclick=()=>Promise.resolve(fn()).catch(()=>{status.textContent='Immagine non visualizzabile sul dispositivo. Riprova o consulta il centro.';});header.append(b);return b;};
 async function show(n){
  if(disposed||loading||!active.length)return;loading=true;try{const token=++generation;cursor=Math.max(0,Math.min(n,active.length-1));const entry=active[cursor];status.textContent='Caricamento immagine…';
  if(entry.asset.bytes>64*1024*1024)throw new Error('Questa serie richiede un visualizzatore per esami voluminosi.');
  let promise=loaded.get(entry.asset.id);
  if(!promise){promise=entry.asset.getBlob().then(blob=>{const imageId=wadouri.fileManager.add(blob);registered.push(imageId);return imageId;});loaded.set(entry.asset.id,promise);}
  const base=await promise;if(disposed||token!==generation)return;
  await view.setStack([base+'?frame='+entry.frame],0);if(disposed||token!==generation)return;
  view.render();defaultCamera=view.getCamera();status.textContent=`Immagine ${cursor+1} di ${active.length}`;
  for(const [key,p] of loaded){if(loaded.size<=2)break;if(key===entry.asset.id)continue;const old=await p;wadouri.fileManager.remove(Number(old.split(':')[1]));loaded.delete(key);}
  }finally{loading=false;}
 }
 async function choose(){clearInterval(timer);active=[];const rows=[...(groups.get(series.value)||[])].sort((a,b)=>(a.metadata.instance||0)-(b.metadata.instance||0));for(const asset of rows){const count=asset.metadata.frames||1;if(count>10000)throw new Error('FRAME_LIMIT');for(let frame=0;frame<count;frame++)active.push({asset,frame});}await show(0);}
 series.onchange=()=>choose().catch(()=>status.textContent='Serie non visualizzabile.');
 button('Precedente',()=>show(cursor-1));button('Successiva',()=>show(cursor+1));
 button('Zoom +',()=>{const c=view.getCamera();view.setCamera({parallelScale:c.parallelScale/1.25});view.render();});
 button('Zoom −',()=>{const c=view.getCamera();view.setCamera({parallelScale:c.parallelScale*1.25});view.render();});
 button('Contrasto +',()=>{const p=view.getProperties();if(p.voiRange){const mid=(p.voiRange.lower+p.voiRange.upper)/2,width=(p.voiRange.upper-p.voiRange.lower)*.8;view.setProperties({voiRange:{lower:mid-width/2,upper:mid+width/2}});view.render();}});
 const play=button('Riproduci',()=>{if(timer){clearInterval(timer);timer=null;play.textContent='Riproduci';}else{play.textContent='Pausa';let busy=false;timer=setInterval(async()=>{if(busy)return;busy=true;try{await show((cursor+1)%active.length);}catch{clearInterval(timer);status.textContent='Sequenza non visualizzabile.';}finally{busy=false;}},150);}});
 button('Ripristina',()=>{view.resetCamera();view.resetProperties();view.render();});
 const resize=new ResizeObserver(()=>engine.resize(true));resize.observe(stage);
 const dispose=()=>{disposed=true;generation++;clearInterval(timer);resize.disconnect();engine.destroy();for(const imageId of registered)wadouri.fileManager.remove(Number(imageId.split(':')[1]));loaded.clear();cache.purgeCache();wadouri.dataSetCacheManager.purge();};
 try{await choose();}catch(e){dispose();throw e;}
 return dispose;
}

// Local ZIP import stays on the device; it never submits or shares the exam.
export async function readLocalZip(file){
 if(file.size>64*1024*1024)throw new Error('Per l’apertura locale usa uno ZIP fino a 64 MB. Per gli esami più grandi chiedi l’invio dal centro.');
 let total=0,count=0;const files=[],pending=[];
 const unzip=new Unzip(entry=>{
  if(++count>1000||entry.name.includes('..')||/^[\\/]|:/.test(entry.name))throw new Error('Archivio non supportato.');
  const chunks=[];let size=0;
  const job=new Promise((resolve,reject)=>{entry.ondata=(error,data,final)=>{if(error){reject(error);return;}size+=data.length;total+=data.length;if(size>64*1024*1024||total>128*1024*1024){entry.terminate();reject(new Error('Archivio troppo grande dopo l’estrazione.'));return;}chunks.push(data);if(final){files.push(new Blob(chunks));resolve();}};});pending.push(job);job.catch(()=>{});entry.start();
 });unzip.register(UnzipInflate);
 try{unzip.push(new Uint8Array(await file.arrayBuffer()),true);await Promise.all(pending);}catch{throw new Error('ZIP non valido o superiore ai limiti di apertura.');}
 const assets=[];let patient,study;
 for(const blob of files){
  const bytes=new Uint8Array(await blob.arrayBuffer());if(bytes.length<132||String.fromCharCode(...bytes.subarray(128,132))!=='DICM')continue;
  const ds=dicomParser.parseDicom(bytes,{untilTag:'x7fe00010'});if(ds.string('x00080016')==='1.2.840.10008.1.3.10')continue;
  const pid=ds.string('x00100020'),uid=ds.string('x0020000d');if(!pid||!uid||(patient&&patient!==pid)||(study&&study!==uid))throw new Error('Lo ZIP contiene studi o pazienti differenti.');patient=pid;study=uid;
  assets.push({id:uniqueId(),metadata:{series_uid:ds.string('x0020000e'),instance:Number(ds.string('x00200013')||0),frames:Number(ds.string('x00280008')||1)},getBlob:async()=>blob});
 }
 if(!assets.length)throw new Error('Nessuna immagine DICOM supportata nello ZIP.');return assets;
}
