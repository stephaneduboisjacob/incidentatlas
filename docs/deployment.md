# Deployment

The Compose stack runs an app/API, a background worker, and a dedicated
PostgreSQL 18 service. PostgreSQL has a private Compose network and persistent
volume; it does not reuse a host database or publish a host port. The API is
published only on `127.0.0.1:3080`, for the host Nginx virtual host. The API
applies checked-in, numbered SQL migrations before it starts serving requests.

## First start

1. Copy `.env.example` to `.env` and replace each placeholder with a different
   value from `openssl rand -hex 32`. Keep `.env` private and out of backups
   unless backups are encrypted.
2. Set `INCIDENTATLAS_PUBLIC_ORIGIN` to the public HTTPS origin.
3. Build and start with `docker compose up -d --build`.
4. Confirm `docker compose ps` reports the database and API healthy.
5. Open the public origin and create the first owner with the setup token in
   `.env`. First-run setup is permanently disabled after an account exists.

Retrieve the setup token directly on the server with
`grep '^INCIDENTATLAS_SETUP_TOKEN=' .env`; do not paste it into tickets, chat,
or logs. Choose the account email and password during the one-time setup.

Use `docker compose logs --tail=100 api worker` for service diagnostics. Logs
contain event names and status codes, not request bodies or credentials.

For tenant and collector integration tests only, add
`docker-compose.test.yml`; it publishes PostgreSQL to `127.0.0.1:55432` and
does not expose it externally. Remove the override after tests with
`docker compose down` followed by the normal production `docker compose up -d`.

## Existing host Nginx

Keep the host reverse proxy and other virtual hosts intact. For the ACME
HTTP-01 bootstrap, copy `deploy/nginx/incidentatlas.http.conf` to a new
`/etc/nginx/sites-available/incidentatlas` file, enable only that new site,
then validate with `nginx -t` before reloading. Issue the certificate with
Certbot's webroot authenticator at `/var/www/incidentatlas-acme` for
`incidentatlas.btcpay.exchange`. After issuance, replace the bootstrap file
with `deploy/nginx/incidentatlas.conf`, validate, and reload. The final vhost
redirects HTTP to HTTPS and proxies to the loopback API port. Never overwrite
another site's configuration.

Certbot renewal should remain enabled through the host's existing timer. Its
deploy hook reloads Nginx only after a successful renewal of this site's
certificate; install `deploy/nginx/incidentatlas-certbot-hook.sh` into
`/etc/letsencrypt/renewal-hooks/deploy/incidentatlas-reload-nginx`.

## Operations

The app container runs as the unprivileged Node user with a read-only root
filesystem, dropped Linux capabilities, no-new-privileges, bounded memory and
process count, and a small private `/tmp`. The worker receives database access
only. Database and artifact volumes are separate and persistent.

Back up the PostgreSQL volume and artifact volume together. Test restore
procedures before relying on IncidentAtlas as evidence storage. Do not enable
connected collection of operational host sources until retention and
backup/restore procedures are implemented and tested and collector enrollment
and revocation are understood by the operator. The development host collector
currently remains in local mode.
