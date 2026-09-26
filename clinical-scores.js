// Score ESC 2024 per FA: calcolo aritmetico, senza raccomandazioni terapeutiche.
export const CHA2DS2_VA_SOURCE='https://www.escardio.org/guidelines/clinical-practice-guidelines/all-esc-practice-guidelines/atrial-fibrillation/';
export function calculateCha2ds2va({age,heartFailure,hypertension,diabetes,stroke,vascularDisease}){
  const years=Number(age);
  if(!Number.isInteger(years)||years<18||years>120)throw new Error('Inserisci un’età valida da 18 a 120 anni.');
  for(const [name,value] of Object.entries({heartFailure,hypertension,diabetes,stroke,vascularDisease}))
    if(typeof value!=='boolean')throw new Error(`Indica sì o no per ${name}.`);
  const parts={scompenso:heartFailure?1:0,ipertensione:hypertension?1:0,eta:years>=75?2:years>=65?1:0,diabete:diabetes?1:0,ictusTIA:stroke?2:0,vasculopatia:vascularDisease?1:0};
  return {total:Object.values(parts).reduce((a,b)=>a+b,0),parts,source:CHA2DS2_VA_SOURCE};
}
