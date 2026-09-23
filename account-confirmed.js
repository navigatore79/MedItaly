const query = new URLSearchParams(location.search);
    const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
    const error = query.get('error') || fragment.get('error');
    const errorCode = query.get('error_code') || fragment.get('error_code') || '';
    const verified = Boolean(fragment.get('access_token') || query.get('code'));
    history.replaceState(null, '', location.pathname);
    const badge = document.getElementById('badge');
    const title = document.getElementById('title');
    const description = document.getElementById('description');
    if (error) {
      badge.textContent = 'Conferma non riuscita'; badge.className = 'badge error';
      title.textContent = 'Il link non è più valido';
      description.textContent = errorCode === 'otp_expired'
        ? 'Il link di conferma è scaduto o è già stato usato. Prova ad accedere: se l’email risulta già verificata, non serve confermarla di nuovo. Altrimenti richiedi un nuovo link dalla registrazione.'
        : 'Non è stato possibile confermare l’email. Prova ad accedere oppure richiedi un nuovo link dalla registrazione.';
    } else if (verified) {
      badge.textContent = 'Email verificata'; badge.className = 'badge';
      title.textContent = 'Email confermata';
      description.textContent = 'La verifica è riuscita. Torna all’app Meditaly per accedere come paziente, oppure apri la dashboard se hai richiesto un account medico. L’accesso medico richiede l’approvazione dell’amministratore.';
    }
