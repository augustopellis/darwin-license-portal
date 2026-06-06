# Aggiornamento darWIN License Portal in produzione

Questa guida descrive la procedura esatta per scaricare l'ultima versione dal repository GitHub e rilanciare i container Docker sul server di produzione.

Il portale si trova in: `/opt/darwin-license-portal`

---

## Prerequisiti

- Accesso SSH al server con utente `root` (o utente con `sudo`)
- Docker e Docker Compose installati
- Il file `.env` già presente in `/opt/darwin-license-portal/.env`

---

## Procedura di aggiornamento

Eseguire i comandi seguenti **nell'ordine indicato**:

```bash
# 1. Entra nella directory del progetto
cd /opt/darwin-license-portal

# 2. Fai il backup del file .env (contiene credenziali e configurazioni locali)
cp .env /root/darwin-license-portal.env.backup

# 3. Scarica le ultime modifiche dal repository remoto (senza applicarle ancora)
git fetch origin

# 4. Ripristina il branch main all'ultima versione remota,
#    scartando qualsiasi modifica locale non committata
git reset --hard origin/main

# 5. Ripristina il file .env dal backup
#    (git reset --hard sovrascrive o elimina file non tracciati se erano stati committati;
#     il restore garantisce che le credenziali locali siano sempre presenti)
cp /root/darwin-license-portal.env.backup .env

# 6. Ricostruisce le immagini Docker e riavvia i container in background
docker compose up -d --build
```

---

## Verifica dopo l'aggiornamento

```bash
# Controlla che i container siano in esecuzione
docker compose ps

# Leggi i log in tempo reale (Ctrl+C per uscire)
docker compose logs -f
```

---

## Note importanti

| Punto | Dettaglio |
|-------|-----------|
| **Backup .env** | Il file `.env` non è tracciato da Git. Il backup in `/root/` assicura che le variabili d'ambiente (JWT secret, credenziali admin, porta) non vengano perse dopo il `reset --hard`. |
| **`git reset --hard`** | Sovrascrive **tutte** le modifiche locali non committate. Non usarlo se hai personalizzazioni che non sono nel repository. |
| **Downtime** | `docker compose up -d --build` ricostruisce le immagini e ricrea i container. Il servizio sarà irraggiungibile per pochi secondi durante il riavvio. |
| **Database SQLite** | Il database (`server/data/`) è montato come volume Docker e **non** viene toccato dall'aggiornamento. |

---

## Rollback rapido

Se l'aggiornamento causa problemi, ripristina il commit precedente:

```bash
cd /opt/darwin-license-portal

# Torna al commit precedente (sostituisci <COMMIT_HASH> con l'hash desiderato)
git log --oneline -10          # trova il commit a cui tornare
git reset --hard <COMMIT_HASH>

# Ripristina il .env
cp /root/darwin-license-portal.env.backup .env

# Riavvia i container
docker compose up -d --build
```
