# Meditaly Dashboard Clinica 2.1

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
