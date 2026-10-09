# Manuale amministratore

Questa guida descrive l'attuale distribuzione Compose e il collector Rust per host. Adattare i comandi al proprio ambiente e leggere `docs/deployment.md`, `docs/collector.md` e `docs/retention.md` prima dell'uso in produzione. Il prodotto è ancora in sviluppo: non usarlo come unico archivio degli incidenti.

## Distribuire il server

La compilazione richiede Node.js 24 e npm; il server usa Docker Engine con Compose. Per esporre il servizio serve un reverse proxy. Lo stack Compose fornito esegue applicazione/API, worker e PostgreSQL 18 su una rete privata. PostgreSQL non pubblica una porta sull'host; l'API ascolta sulla porta locale 3080 per Nginx.

1. Clonare il repository ed esaminare la configurazione di distribuzione inclusa.
2. Copiare `.env.example` in `.env`. Generare un valore casuale distinto per ogni segreto richiesto, ad esempio con `openssl rand -hex 32`. Proteggere il file e non inserirlo nel controllo versione.
3. Impostare `INCIDENTATLAS_PUBLIC_ORIGIN` sull'origine HTTPS esatta visitata dagli utenti.
4. Eseguire `docker compose up -d --build`, quindi controllare `docker compose ps` e gli endpoint di salute live/ready.
5. Per avviare ACME HTTP-01, creare un nuovo virtual host Nginx partendo da `deploy/nginx/incidentatlas.http.conf`. Verificare con `nginx -t`, ottenere il certificato, installare `deploy/nginx/incidentatlas.conf`, verificare di nuovo e ricaricare Nginx. Non sostituire la configurazione di un altro sito. Mantenere attivo il timer di rinnovo Certbot e installare l'hook fornito.
6. Creare il primo proprietario usando `INCIDENTATLAS_SETUP_TOKEN` presente in `.env`. Recuperarlo localmente sul server; non inviarlo in chat e non inserirlo nei log. La configurazione iniziale viene disabilitata definitivamente dopo la creazione del primo account.

La guida di distribuzione del repository contiene esempi precisi per dominio, percorsi dei certificati e comandi di backup. Sostituire i domini di esempio. La modalità connessa del collector richiede HTTPS con certificato valido.

## Proteggere l'installazione

Usare valori diversi per ogni segreto e ruotarli dopo una possibile esposizione. Limitare l'accesso a `.env`, backup, dati PostgreSQL, artefatti e log. Non pubblicare la porta del database. Mantenere l'API su loopback dietro HTTPS. Usare password amministrative robuste e i normali controlli di accesso all'host.

Il MVP offre una configurazione iniziale proprietario monouso, accesso locale e isolamento per organizzazione; non dispone ancora di una console completa per invitare utenti e gestire i ruoli. Evitare di condividere account e credenziali di configurazione iniziale senza necessità. Consultare [Sicurezza e privacy](security-and-privacy.md) e `SECURITY.md`.

## Registrare e gestire un collector

Installare il binario Rust e l'unità systemd inclusi. Eseguirli con l'utente di servizio dedicato `incidentatlas`, non come root. Iniziare con `dry-run`, esaminare gli eventi normalizzati proposti e i nomi delle regole di redazione; passare poi a `local` per verificare la coda SQLite limitata. Attivare `connected` solo dopo aver esaminato le fonti, verificato HTTPS e predisposto un backup testato copiato fuori dall'host monitorato.

Sugli host condivisi, limitare le unità systemd con `sources.systemd_units`. La fonte systemd usa campi strutturati del ciclo di vita e non invia il testo dei messaggi del journal. Docker è disattivato per impostazione predefinita: il socket Docker e il gruppo `docker` equivalgono ai privilegi root. Abilitarlo richiede di accettare e documentare tale privilegio. Il watcher Nginx attuale controlla solo file regolari esplicitamente elencati, rifiuta i link simbolici e invia percorso e hash prima/dopo; non invia il contenuto e non esplora ricorsivamente le directory. La raccolta operativa PostgreSQL, GitHub e gli altri connettori previsti non sono implementati in questa versione.

Conservare il token di registrazione e le credenziali del collector in file protetti distinti. Il token è monouso; il server conserva l'hash delle credenziali del collector e ne consente la revoca. Non inserire segreti nel TOML, negli argomenti dei comandi, nei ticket o nella cronologia della shell. `incidentatlas-agent doctor` controlla lo stato locale senza mostrare i valori segreti.

Comandi utili: `status`, `doctor`, `test-redaction`, `test-source systemd`, `test-source docker` e `print-config`. La coda è persistente e limitata; controllarne lo stato, i contatori di perdita e lo spazio su disco. Un processo attivo non garantisce che gli eventi siano stati consegnati.

## Backup, conservazione e blocchi legali

Eseguire il backup insieme di PostgreSQL e del volume degli artefatti. Usare `deploy/scripts/backup.sh <directory-privata>` e verificare il risultato con `deploy/scripts/verify-backup.sh <directory-backup>`. Questi comandi fermano brevemente API e worker; i collector accodano gli eventi durante la pausa. La verifica controlla i digest degli artefatti e ripristina il database in un database temporaneo per confrontare il numero di righe. Gli script non pianificano i backup, non li copiano fuori host e non sostituiscono una prova completa di ripristino. Cifrare i backup, copiarli su uno storage separato e provare il ripristino.

In **Retention & holds**, proprietari e amministratori impostano separatamente le durate per eventi, artefatti, audit e generazioni AI riservate. Ridurre una durata richiede conferma e accoda una pulizia asincrona; i blocchi legali proteggono le prove coperte. Un blocco globale copre l'organizzazione; un blocco per incidente copre la relativa finestra configurata. Indicare un motivo quando si crea o si rilascia un blocco. Alla scadenza il contenuto dell'artefatto viene rimosso, ma i metadati restano; il download non è più disponibile. La conservazione non elimina automaticamente incidenti, ipotesi, blocchi o account. La conservazione delle generazioni AI è riservata perché la memorizzazione AI non è implementata.

## Operazioni ordinarie e risposta agli incidenti

Controllare `docker compose ps`, gli endpoint di salute, i log dei servizi, lo spazio su disco, i volumi del database e degli artefatti, le code dei collector e l'età dei backup. I log applicativi non includono volutamente i corpi delle richieste o le credenziali. Se l'ingestione non è disponibile, i collector dovrebbero accodare localmente gli eventi; monitorare gli avvisi di overflow e risolvere il problema prima che la coda raggiunga il limite.

In caso di possibile compromissione di credenziali: revocare il collector o l'accesso interessato se possibile, ruotare i segreti, conservare log e backup pertinenti, esaminare l'audit e indagare da un host attendibile. Prima di un aggiornamento, leggere le note di rilascio, creare e verificare un backup, applicare le migrazioni documentate e controllare lo stato e la capacità di ripristino.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>
