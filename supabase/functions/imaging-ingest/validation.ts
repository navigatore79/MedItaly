export const sha256=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export function canonical(x:any):string{return x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';}
const text=(x:any,name:string,max=100)=>{if(typeof x!=='string'||!x.trim()||x.length>max||/[\x00-\x1f]/.test(x))throw new TypeError('INVALID_'+name);return x.trim();};
export function validateManifest(m:any){
 if(!m||typeof m!=='object'||Array.isArray(m))throw new TypeError('INVALID_MANIFEST');
 const out:any={version:1,request_id:text(m.request_id,'REQUEST_ID'),issuer:text(m.issuer,'ISSUER'),patient_id:text(m.patient_id,'PATIENT_ID'),title:text(m.title,'TITLE',200),final:m.final};
 if(m.version!==1||m.final!==true)throw new TypeError('FINAL_RELEASE_REQUIRED');
 for(const k of ['birth_date','study_date'])if(m[k]){if(!/^\d{4}-\d{2}-\d{2}$/.test(m[k])||!Number.isFinite(Date.parse(m[k]))||new Date(m[k]).toISOString().slice(0,10)!==m[k])throw new TypeError('INVALID_DATE');out[k]=m[k];}
 if(m.fiscal_code){out.fiscal_code=text(m.fiscal_code,'FISCAL_CODE').toUpperCase();if(!/^[A-Z0-9]{16}$/.test(out.fiscal_code))throw new TypeError('INVALID_FISCAL_CODE');}
 for(const k of ['accession_number','study_uid'])if(m[k])out[k]=text(m[k],k);
 if(!Array.isArray(m.files)||m.files.length<1||m.files.length>32)throw new TypeError('INVALID_FILES');
 let total=0;
 out.files=m.files.map((f:any)=>{if(!['report','dicom','archive'].includes(f.kind)||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>1073741824||!/^[a-f0-9]{64}$/.test(f.sha256||''))throw new TypeError('INVALID_FILE');total+=f.bytes;return{kind:f.kind,bytes:f.bytes,sha256:f.sha256};});
 // Bounded first serverless release: reject oversize BEFORE issuing upload URLs.
 if(total>64*1048576)throw new TypeError('DELIVERY_TOO_LARGE_64_MIB');
 return out;
}
export async function readJson(req:Request,max:number){
 if(!req.headers.get('content-type')?.includes('application/json'))throw new TypeError('JSON_REQUIRED');
 const reader=req.body?.getReader();if(!reader)throw new TypeError('EMPTY_BODY');let size=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new TypeError('BODY_TOO_LARGE');}chunks.push(value);}
 const data=new Uint8Array(size);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
 try{return JSON.parse(new TextDecoder().decode(data));}catch{throw new TypeError('INVALID_JSON');}
}
