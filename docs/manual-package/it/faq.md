# Domande frequenti

## Che cos'è IncidentAtlas?

Un registratore auto-ospitabile di cambiamenti operativi che aiuta a ricostruire la timeline intorno a un'interruzione o a un incidente di sicurezza.

## È una piattaforma di log, APM, SIEM o dashboard di metriche?

No. Si concentra su cambiamenti compatti e prove collegate, non sull'invio arbitrario di log, tracing, rilevamento SIEM o metriche generiche.

## Cosa può registrare il collector attuale?

La versione attuale supporta eventi strutturati del ciclo di vita delle unità systemd, eventi di ciclo di vita dei container Docker se abilitati e hash di file Nginx configurati esplicitamente. Docker è disattivato per impostazione predefinita. La raccolta operativa PostgreSQL, i deployment GitHub, i metadati dei certificati e gli stati esterni sono previsti, ma non disponibili in questa versione.

## Invia file di configurazione, SQL o segreti dei container?

Il watcher Nginx invia percorsi configurati e hash SHA-256 prima/dopo, non il contenuto. Systemd non invia il testo dei messaggi del journal. Variabili d'ambiente e log Docker sono esclusi. La versione attuale non raccoglie testo delle query o parametri PostgreSQL.

## IncidentAtlas identifica la causa principale?

No. Il punteggio deterministico ordina gli eventi con fattori spiegabili. Sono ipotesi, non probabilità o prove. Una persona deve esaminare le prove e confermare esplicitamente un risultato.

## Richiede un servizio AI o accesso a Internet?

No. Correlazione e bozza di postmortem attuali sono deterministiche e restano nell'installazione. I collector connessi hanno bisogno di accesso HTTPS al server; il flusso auto-ospitato principale non richiede un provider AI esterno.

## Dove vengono archiviate le prove?

I record normalizzati e i metadati sono in PostgreSQL. I payload degli artefatti sono in un filesystem locale indirizzato per digest. L'operatore controlla server, storage, accessi e backup.

## Posso abilitare Docker senza privilegi aggiuntivi?

La raccolta Docker è disattivata perché il socket Docker e il gruppo `docker` equivalgono all'accesso root. Abilitarla solo dopo aver valutato e documentato tale privilegio.

## Come funzionano conservazione e blocchi legali?

Proprietari e amministratori impostano periodi separati. Ridurli con conferma avvia la pulizia in background. Un blocco globale o specifico per incidente protegge le prove coperte finché un amministratore non lo rilascia indicando un motivo.

## È pronto per essere il mio unico archivio di prove in produzione?

No. Questa versione è ancora in sviluppo. I backup sono avviati dall'operatore, devono essere copiati fuori host e richiedono un piano di ripristino verificato. Conservare altri registri operativi finché maturità e procedure di ripristino non soddisfano i propri requisiti.

## Qual è la licenza?

La scelta della licenza è in sospeso. Il repository riserva attualmente tutti i diritti; non presumere che la redistribuzione sia consentita. Controllare il repository prima di usare il prodotto oltre la valutazione.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>
