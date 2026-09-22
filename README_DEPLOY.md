# Meditaly Dashboard Clinica 2.2

Dashboard statica per Vercel/Netlify collegata al progetto Supabase Meditaly.

Novità 2.1:
- richieste di collegamento medico-paziente con Accetta/Rifiuta;
- profilo pubblico del medico (nome, specializzazione, centro, albo, visibilità e disponibilità richieste);
- coda degli elementi inseriti dal paziente da verificare;
- tab `Invii paziente` dentro la scheda paziente;
- conferma/rifiuto di terapia o controllo proposto dal paziente;
- dopo conferma, terapia/controllo viene creato nel percorso clinico.

## Deploy su Vercel Drop
Carica questa cartella o lo ZIP su https://vercel.com/drop . Non è richiesto un repository Git per il test.

La publishable key Supabase presente nel frontend è una chiave pubblica prevista per client web; l'accesso ai dati resta protetto da Supabase Auth/RLS.


## Document Center v2.2

Le route pubbliche stabili sono:
- /documenti
- /privacy
- /privacy-clinician
- /terms
- /security
- /retention
- /beta
- /medi-ai
- /proprieta-intellettuale
- /subprocessors

I documenti pubblici sono serviti dalla Edge Function Supabase `legal-docs` e la dashboard registra/riferisce la versione documentale 2.2.

La DPIA completa, l'incident response operativo e i dettagli interni di sicurezza non devono essere pubblicati su questo repository pubblico.
