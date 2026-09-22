# Meditaly Dashboard Clinica — beta RC1 / documenti v2.2

Pubblicare la dashboard solo da repository controllato. Non inserire service-role key, segreti Firebase, credenziali cliniche o dati sanitari reali nel frontend o nel repository.

## Gate prima dei dati reali

L'uso di dati sanitari reali resta bloccato finché non risultano formalmente adottati e verificati:
- DPIA;
- registro dei trattamenti;
- matrice dei ruoli Titolare/Responsabile e DPA art. 28 ove necessari;
- retention/cancellazione;
- procedura incident/data breach;
- riesame documentato dell'eventuale obbligo DPO/RPD;
- verifica fornitori/sub-responsabili e trasferimenti;
- valutazione regolatoria MDR/software medicale;
- test di sicurezza e restore.

Il limite organizzativo di 200 pazienti non è una soglia legale di esenzione.

## Test funzionali minimi

- login/logout e reset password;
- TOTP, ritentativo e AAL2;
- registrazione medico e approvazione;
- directory/profilo pubblico;
- richieste paziente e collegamenti;
- elenco assistiti e revoca accessi;
- check-in verde/giallo/rosso;
- terapie, controlli, protocolli;
- chat e notifiche immediate;
- import paziente/OCR con stato Pending e conferma umana;
- apertura documenti con URL firmato;
- referti multipagina e rollback;
- link Privacy/Termini/Sicurezza/Retention/Medi/IA/IP/Fornitori;
- registrazione versione/azione delle prese visioni e dei consensi.

## Test di sicurezza

- RLS cross-account e cross-clinician;
- storage privato;
- signed URL a scadenza;
- nessun dato sanitario nel lock-screen payload;
- nessun secret nel client/repository;
- CSP e security headers Vercel;
- audit delle operazioni rilevanti;
- backup/restore;
- advisor Supabase security/performance.

## Esito

Il rilascio con dati reali richiede un verbale di approvazione del gate e la chiusura delle non conformità bloccanti.
