import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

const PROJECT_URL = 'https://ejlhgtodmcadmdhbujkf.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_QoVgKCNOTSbrXFgXdusqfA_5_OM5jwM';
const query = new URLSearchParams(location.search);
const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
const linkError = query.get('error') || fragment.get('error');
const errorCode = query.get('error_code') || fragment.get('error_code');
const hasRecoveryLink = (fragment.get('type') === 'recovery' && Boolean(fragment.get('access_token'))) ||
  (query.get('type') === 'recovery' && Boolean(query.get('code')));
const status = document.getElementById('status');
const form = document.getElementById('form');
const button = document.getElementById('save');
let client;

function show(message, kind = '') {
  status.textContent = message;
  status.className = 'notice' + (kind ? ' ' + kind : '');
}

async function initialize() {
  if (linkError) {
    history.replaceState(null, '', location.pathname);
    show(errorCode === 'otp_expired'
      ? 'Questo link è scaduto o è già stato usato. Richiedi un nuovo link dalla schermata di accesso.'
      : 'Non è stato possibile verificare il link. Richiedi un nuovo link dalla schermata di accesso.', 'error');
    return;
  }
  if (!hasRecoveryLink) {
    show('Apri il link ricevuto nell’email di recupero password. Se lo hai già utilizzato, richiedine uno nuovo.', 'error');
    return;
  }
  try {
    client = createClient(PROJECT_URL, PUBLISHABLE_KEY, {
      auth: { detectSessionInUrl: true, persistSession: false, autoRefreshToken: false },
    });
    const { data: { session }, error } = await client.auth.getSession();
    if (error || !session?.access_token) throw error || new Error('Sessione non disponibile');
    const { data: { user }, error: userError } = await client.auth.getUser(session.access_token);
    if (userError || !user) throw userError || new Error('Link non valido');
    history.replaceState(null, '', location.pathname);
    show('Link verificato. Ora puoi scegliere una nuova password.', 'success');
    form.classList.remove('hidden');
  } catch {
    history.replaceState(null, '', location.pathname);
    show('Il link non è più valido. Richiedi un nuovo recupero password dall’app Meditaly o dalla dashboard.', 'error');
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const password = document.getElementById('password').value;
  const confirm = document.getElementById('confirm').value;
  if (password.length < 8) return show('La password deve contenere almeno 8 caratteri.', 'error');
  if (password !== confirm) return show('Le due password non coincidono.', 'error');
  button.disabled = true;
  show('Aggiornamento della password in corso…');
  try {
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
    form.classList.add('hidden');
    document.getElementById('password').value = '';
    document.getElementById('confirm').value = '';
    show('Password aggiornata. Torna a Meditaly ed effettua l’accesso con la nuova password.', 'success');
    await client.auth.signOut();
  } catch {
    show('La password non è stata aggiornata. Riprova o richiedi un nuovo link se è scaduto.', 'error');
    button.disabled = false;
  }
});

initialize();
