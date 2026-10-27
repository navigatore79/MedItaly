# Centro iniziale MEDIapp

Nome: Laboratorio di Emodinamica - PO Santa Maria delle Grazie di Pozzuoli - ASL NA 2 Nord.
Codice pazienti: `0000` (testo, quattro zeri).
Dashboard: https://med-italy.vercel.app/center.html.

Il paziente accede al proprio account e inserisce il codice. La funzione `patient_request_center_by_code` crea una richiesta in attesa; solo l'accettazione del responsabile assegna il centro. Ripetere la richiesta non crea duplicati. Il codice non è una password e non permette di aprire la dashboard o vedere altri pazienti. Il vecchio QR non è configurato per questo centro.

Il secondo fattore resta obbligatorio per impostazione predefinita. Un amministratore con secondo fattore può autorizzare un’eccezione per un singolo responsabile e un singolo centro, tramite `admin_set_center_manager_mfa`. Questa eccezione non attribuisce ruoli clinici e non modifica la protezione di altri account o aree. Per aggiungere un responsabile, anche non medico, usare «Responsabili dei centri» nell'amministrazione: selezionare centro e account attivo, quindi «Abilita responsabile». La sola gestione del centro non attribuisce funzioni cliniche.

La dashboard ha sezioni Richieste e Pazienti, ricerca per nome, codice copiabile e comandi di almeno 44 pixel. La struttura è verificata a 320, 360, 390, 768 e 1280 pixel, con nomi lunghi e casi di errore. Le fixture di browser sono sintetiche. Il test SQL usa account sintetici e rollback: non lascia pazienti o richieste di prova.

La nuova interfaccia Android per il codice è predisposta nel ramo MEDIapp, al primo accesso e nella pagina Medici e centro; la sua distribuzione richiede una nuova build. Le versioni già installate mantengono il loro flusso di selezione del centro.

Verifiche:
- `tests/center-code-access.sql`: codice, richiesta in attesa, assenza di associazione automatica, duplicati, eccezione MFA individuale, autorizzazione del responsabile e isolamento tra centri.
- `tests/center-mobile.test.cjs`: eseguire con Playwright e Chromium disponibili, eventualmente impostando `PLAYWRIGHT_MODULE` e `CHROMIUM_PATH`; verifica dimensioni, accettazione, ricerca, errori e accessi negati.
