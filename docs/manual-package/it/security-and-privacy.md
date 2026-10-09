# Guida a sicurezza e privacy

## Impegno sulla raccolta

IncidentAtlas è progettato per conservare cambiamenti di stato compatti utili alla ricostruzione. Il collector applica la redazione prima della trasmissione connessa. Le fonti attualmente disponibili sono eventi strutturati del ciclo di vita systemd, metadati del ciclo di vita dei container Docker se abilitati e hash di file Nginx configurati esplicitamente. Il collector non invia testo dei messaggi del journal, variabili d'ambiente Docker, log dei container, contenuto dei file Nginx, testo o parametri SQL, payload applicativi, chiavi private o codice sorgente dei repository.

Questo è un obiettivo progettuale, non la garanzia che ogni host o fonte personalizzata sia priva di rischi. Esaminare l'output di `dry-run`, limitare le fonti e aggiungere regole di redazione per identificativi locali quando necessario.

## Classificazione dei dati

| Classe | Esempi | Trattamento |
| --- | --- | --- |
| PUBLIC | Versione software pubblicata | Può essere condivisa |
| OPERATIONAL | Stato servizio, digest immagine, scadenza certificato | Record operativo controllato dal tenant |
| SENSITIVE | Hostname, percorsi, identificativi utente | Minimizzare, limitare l'accesso, applicare la conservazione |
| SECRET | Password, token, chiavi private, cookie | Redigere localmente; non persistere intenzionalmente |
| PROHIBITED | Dati clienti, righe di tabelle, contenuto di chiavi private | Non raccogliere |

## Misure per gli operatori

- Usare prima `dry-run`, poi `local`, infine `connected`.
- Eseguire l'agente con l'account dedicato non privilegiato e concedere accesso minimo. Lasciare Docker disattivato a meno che non si accetti il privilegio equivalente a root.
- Usare HTTPS con verifica del certificato; non disabilitare i controlli TLS.
- Proteggere token di configurazione, credenziali dei collector, `.env`, backup e archivi dati.
- Mantenere PostgreSQL privato e l'API pubblica dietro HTTPS.
- Esaminare i metadati degli eventi e i percorsi monitorati prima di attivare la raccolta.
- Cifrare i backup, conservarli fuori host e provarli. Attendere la verifica di copie esterne e procedure di ripristino prima di attivare la raccolta connessa su un host monitorato.
- Configurare con attenzione conservazione e blocchi legali. Una riduzione confermata può rimuovere prove in modo asincrono.

## Accesso, integrità e limiti

Le query API impongono l'isolamento per organizzazione. Le credenziali dei collector sono memorizzate come hash e possono essere revocate. Gli eventi hanno digest SHA-256; gli artefatti sono indirizzati tramite digest e verificati nelle procedure di pulizia e backup. Un digest può rilevare alcune modifiche ai byte archiviati, ma non prova che un evento sia veritiero se l'host monitorato è compromesso. L'orologio può essere errato, il collector può essere offline e l'assenza di un evento non prova che non ci sia stato un cambiamento.

L'analisi del prodotto è disattivata per impostazione predefinita. Il MVP attuale non include un'interfaccia completa di gestione degli account, un provider d'identità esterno, una fonte eventi PostgreSQL, snapshot completi della configurazione, backup esterni automatizzati o analisi causale AI. Consultare `docs/threat-model.md`, `docs/privacy.md` e `SECURITY.md` per ipotesi dettagliate e segnalazione delle vulnerabilità.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>
