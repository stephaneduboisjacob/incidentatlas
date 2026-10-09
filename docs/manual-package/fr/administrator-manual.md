# Manuel administrateur

Ce guide couvre le déploiement Compose actuel et le collecteur hôte Rust. Avant une mise en production, adaptez les commandes à votre environnement et lisez `docs/deployment.md`, `docs/collector.md` et `docs/retention.md`. Le produit est encore en développement : ne l’utilisez pas comme unique registre d’incident.

## Déployer le serveur

La compilation requiert Node.js 24 et npm ; le serveur utilise Docker Engine avec Compose. Une installation exposée nécessite un proxy inverse. La pile Compose fournie comprend l’application/API, le worker et PostgreSQL 18 sur un réseau privé. PostgreSQL n’est pas publié sur un port de l’hôte ; l’API écoute sur le port local 3080 pour Nginx.

1. Clonez le dépôt et examinez la configuration de déploiement fournie.
2. Copiez `.env.example` vers `.env`. Générez une valeur aléatoire unique pour chaque secret requis, par exemple avec `openssl rand -hex 32`. Protégez ce fichier et ne le versionnez pas.
3. Définissez `INCIDENTATLAS_PUBLIC_ORIGIN` sur l’origine HTTPS exacte utilisée par les personnes.
4. Lancez `docker compose up -d --build`, puis vérifiez `docker compose ps` et les points de santé live/ready.
5. Pour ACME HTTP-01, créez un nouvel hôte virtuel Nginx à partir de `deploy/nginx/incidentatlas.http.conf`. Validez avec `nginx -t`, obtenez le certificat, installez `deploy/nginx/incidentatlas.conf`, validez à nouveau et rechargez Nginx. Ne remplacez pas la configuration d’un autre site. Conservez le minuteur de renouvellement Certbot et installez le hook fourni.
6. Créez le premier compte propriétaire avec `INCIDENTATLAS_SETUP_TOKEN` dans `.env`. Récupérez-le localement sur le serveur ; ne l’envoyez pas par messagerie et ne l’inscrivez pas dans les journaux. L’initialisation est définitivement désactivée après la création du premier compte.

Le guide de déploiement du dépôt contient les exemples exacts de domaine, chemins de certificat et commandes de sauvegarde. Remplacez les domaines d’exemple. Le mode connecté du collecteur exige un certificat HTTPS valide.

## Sécuriser l’installation

Utilisez une valeur différente pour chaque secret et faites une rotation après toute exposition suspectée. Limitez l’accès à `.env`, aux sauvegardes, aux données PostgreSQL, aux artefacts et aux journaux. Ne publiez pas le port de la base. Gardez l’API sur loopback derrière HTTPS. Utilisez un mot de passe administrateur robuste et les contrôles d’accès habituels pour l’hôte.

Le MVP propose une initialisation propriétaire à usage unique, une connexion locale et un cloisonnement par organisation ; il ne comporte pas encore de console complète d’invitation et de gestion des rôles. Ne partagez pas les comptes et secrets d’initialisation à la légère. Consultez [Sécurité et confidentialité](security-and-privacy.md) et `SECURITY.md`.

## Enrôler et exploiter un collecteur

Installez le binaire Rust et l’unité systemd fournis. Exécutez-les avec le compte de service dédié `incidentatlas`, jamais en tant que root. Commencez en mode `dry-run` : examinez les événements normalisés proposés et les noms des règles de masquage. Passez ensuite en mode `local` pour vérifier la file SQLite bornée. N’activez `connected` qu’après avoir défini le périmètre des sources, vérifié HTTPS et établi une sauvegarde testée copiée hors de l’hôte surveillé.

Sur les hôtes partagés, limitez les unités systemd avec `sources.systemd_units`. La source systemd utilise des champs de cycle de vie structurés et n’envoie pas le texte des messages du journal. Docker est désactivé par défaut : le socket Docker et le groupe `docker` équivalent à un accès root. Son activation exige d’accepter et de documenter ce privilège. La surveillance Nginx actuelle interroge uniquement les fichiers réguliers expressément listés, refuse les liens symboliques et n’envoie que le chemin et les empreintes avant/après ; elle ne transmet pas le contenu et ne parcourt pas récursivement les répertoires. La collecte opérationnelle PostgreSQL, GitHub et les autres connecteurs prévus ne sont pas implémentés dans cette version.

Placez le jeton d’enrôlement et les identifiants du collecteur dans des fichiers protégés distincts. Le jeton est à usage unique ; le serveur ne conserve que le condensat des identifiants du collecteur et permet leur révocation. Ne mettez jamais ces secrets dans le fichier TOML, les arguments de commande, les tickets ou l’historique du shell. `incidentatlas-agent doctor` vérifie l’état local sans révéler les valeurs secrètes.

Commandes utiles : `status`, `doctor`, `test-redaction`, `test-source systemd`, `test-source docker` et `print-config`. La file est persistante et bornée : surveillez son état, ses compteurs de perte et l’espace disque. Un processus actif ne garantit pas que les événements ont été livrés.

## Sauvegardes, conservation et gel juridique

Sauvegardez ensemble PostgreSQL et le volume d’artefacts. Lancez `deploy/scripts/backup.sh <répertoire-privé>`, puis validez la sauvegarde avec `deploy/scripts/verify-backup.sh <répertoire-de-sauvegarde>`. Ces commandes suspendent brièvement l’API et le worker ; les collecteurs gardent les événements en file. La vérification contrôle les empreintes des artefacts et restaure la base dans une base temporaire pour comparer les nombres de lignes. Les scripts ne planifient pas les sauvegardes, ne les copient pas hors site et ne remplacent pas une répétition complète de restauration. Chiffrez les sauvegardes, copiez-les sur un stockage distinct et testez la restauration.

Dans **Retention & holds**, les propriétaires et administrateurs règlent séparément les durées pour événements, artefacts, audits et génération d’IA réservée. Une réduction exige une confirmation et déclenche un nettoyage asynchrone ; les gels juridiques protègent les preuves couvertes. Un gel global couvre l’organisation ; un gel d’incident couvre sa fenêtre configurée. Saisissez un motif lors de la création et de la levée du gel. Après expiration, le contenu d’un artefact est supprimé mais ses métadonnées restent ; son téléchargement échoue alors. La conservation ne supprime pas automatiquement les incidents, hypothèses, gels ou comptes. La durée de génération d’IA est réservée, car cette fonction de stockage n’est pas implémentée.

## Exploitation et réponse aux incidents

Vérifiez `docker compose ps`, les points de santé, les journaux des services, l’espace disque, les volumes de données et d’artefacts, les files des collecteurs et la fraîcheur des sauvegardes. Les journaux applicatifs n’incluent volontairement ni corps de requête ni identifiants. En cas d’indisponibilité de l’ingestion, les collecteurs doivent conserver les événements localement ; surveillez les alertes de débordement et résolvez le problème avant d’atteindre la limite de file.

En cas de compromission suspectée d’un identifiant : révoquez le collecteur ou l’accès concerné lorsque possible, faites tourner les secrets, préservez les journaux et sauvegardes utiles, examinez l’audit et enquêtez depuis un hôte fiable. Avant une mise à niveau, lisez les notes de version, créez et vérifiez une sauvegarde, appliquez les migrations documentées puis contrôlez l’état et la capacité de restauration.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>
