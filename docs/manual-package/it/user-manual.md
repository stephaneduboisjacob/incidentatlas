# Manuale utente

## Cosa fa IncidentAtlas

IncidentAtlas registra cambiamenti operativi compatti e li dispone intorno a un incidente, così una persona può esaminare cosa è cambiato, quando e quali prove sostengono una possibile spiegazione. I suggerimenti attuali usano un punteggio deterministico. Un suggerimento è un'ipotesi, non un'attribuzione automatica della causa.

## Accesso e spazio di lavoro

Aprire l'indirizzo HTTPS di IncidentAtlas della propria organizzazione e accedere con l'account creato durante la configurazione iniziale. Se non si dispone di un account, contattare un proprietario o un amministratore: la versione attuale non offre inviti self-service né una schermata di gestione degli utenti. Usare **Sign out** al termine, soprattutto su una postazione condivisa.

La panoramica mostra gli incidenti aperti, i cambiamenti recenti, gli host presenti nella vista e lo stato generale dell'ingestione. Selezionare **Refresh** per aggiornare. Un host compare quando il server accetta un evento dal suo collector.

## Esaminare la timeline dei cambiamenti

Scegliere **All recent events** per consultare gli eventi recenti oppure selezionare un incidente per caricare la relativa finestra temporale. Per impostazione predefinita comprende i 60 minuti precedenti e i 30 minuti successivi all'inizio dell'incidente. Selezionare un host e una categoria per restringere l'elenco. Gli orari sono visualizzati nel fuso orario del browser e memorizzati in UTC.

Selezionare una riga per aprire **Evidence detail**. Esaminare origine, risorsa, tipo di cambiamento, gravità, stato prima/dopo, fattori di correlazione e digest SHA-256 dell'evento. Il digest aiuta a verificare l'integrità, ma non prova che l'host di origine fosse attendibile. Alcuni eventi contengono solo metadati o hash, senza una copia della configurazione.

## Dichiarare un incidente

Usare **Declare incident** e inserire un titolo chiaro, l'ora di inizio, la gravità e i nomi dei servizi interessati. Indicare quando sono iniziati i sintomi, non quando qualcuno ha aperto IncidentAtlas. I nomi dei servizi aiutano il motore a trovare risorse corrispondenti. Creare la finestra dell'incidente e poi esaminare gli eventi circostanti.

Il MVP non offre ancora un editor completo del ciclo di vita dell'incidente. Annotare il contesto dell'indagine e il feedback sulle ipotesi; la gestione degli stati è limitata.

## Valutare possibili fattori

Selezionare **Analyze incident window**. IncidentAtlas ordina le prove usando fattori visibili come vicinanza temporale, corrispondenza con un servizio coinvolto, rilevanza del tipo di evento e termini associati ai sintomi. Il motore attuale è deterministico e non usa un LLM. Il punteggio serve a stabilire priorità, non è una probabilità.

Aprire l'evento collegato prima di esprimere un giudizio. Selezionare **Investigate**, **Reject** o **Confirm** solo quando le prove giustificano la decisione. **Confirm** registra `confirmed_by_human`; è l'unica azione che marca una causa come confermata da una persona. Aggiungere una nota all'evento per conservare la propria interpretazione. Un punteggio basso o l'assenza di ipotesi non dimostrano che non esista una causa.

## Creare una bozza di postmortem

All'interno di un incidente, selezionare **Download deterministic postmortem draft**. Il file Markdown riassume l'incidente e collega le affermazioni agli ID degli eventi e ai digest delle prove. È una bozza: verificare ogni affermazione, aggiungere l'impatto sui clienti e le azioni correttive, e distinguere i risultati confermati dalle questioni aperte prima di condividerla.

## Disponibilità delle prove

Eventi e artefatti hanno periodi di conservazione distinti. Un artefatto scaduto può restare visibile come metadato ma non essere scaricabile. Se un'indagine richiede di conservare le prove, chiedere a un proprietario o amministratore di attivare un blocco legale prima della scadenza. Non copiare artefatti sensibili in posizioni non approvate.

## Buone pratiche di indagine

Partire dall'ora del sintomo e dal servizio interessato. Confrontare i cambiamenti precedenti e successivi, esaminare le prove di origine e cercare anche elementi contraddittori. Annotare l'incertezza. Orari, identità dell'host ed eventi possono essere incompleti o influenzati da un host compromesso.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>
