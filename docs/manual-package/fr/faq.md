# Foire aux questions

## Qu’est-ce qu’IncidentAtlas ?

Un enregistreur de changements opérationnels auto-hébergeable qui aide à reconstituer la chronologie d’une panne ou d’un incident de sécurité.

## Est-ce une plateforme de journaux, d’APM, un SIEM ou un tableau de métriques ?

Non. IncidentAtlas se concentre sur les changements compacts et les preuves associées, pas sur l’ingestion de journaux arbitraires, le traçage, la détection SIEM ou les métriques générales.

## Que peut enregistrer le collecteur actuel ?

La version actuelle prend en charge les événements structurés du cycle de vie des unités systemd, les événements de cycle de vie des conteneurs Docker si activés, et les empreintes des fichiers Nginx explicitement configurés. Docker est désactivé par défaut. La collecte opérationnelle PostgreSQL, les déploiements GitHub, les métadonnées de certificats et les états de services externes sont prévus, mais absents de cette version.

## Les fichiers de configuration, SQL ou secrets de conteneurs sont-ils envoyés ?

La surveillance Nginx envoie les chemins configurés et les empreintes SHA-256 avant/après, pas le contenu. Systemd n’envoie pas le texte des messages du journal. Les variables d’environnement et journaux Docker sont exclus. La version actuelle ne collecte ni texte SQL ni paramètres PostgreSQL.

## IncidentAtlas trouve-t-il la cause racine ?

Non. Le score déterministe priorise les événements à l’aide de facteurs explicables. Ce sont des hypothèses, pas des probabilités ou des preuves. Une personne doit examiner les éléments et confirmer explicitement un constat.

## Faut-il un service d’IA ou un accès Internet ?

Non. La corrélation actuelle et le brouillon de postmortem sont déterministes et restent dans l’installation. Les collecteurs connectés ont besoin d’un accès HTTPS au serveur ; le flux auto-hébergé de base ne nécessite aucun fournisseur d’IA externe.

## Où les preuves sont-elles stockées ?

Les enregistrements normalisés et métadonnées sont dans PostgreSQL. Les contenus d’artefacts sont dans un système de fichiers local adressé par empreinte. L’opérateur contrôle le serveur, le stockage, les accès et les sauvegardes.

## Puis-je activer Docker sans privilège supplémentaire ?

La collecte Docker est désactivée par défaut, car le socket Docker et le groupe `docker` équivalent à un accès root. Ne l’activez qu’après avoir évalué et documenté ce privilège.

## Comment fonctionnent la conservation et les gels juridiques ?

Les propriétaires et administrateurs définissent des durées distinctes. Une réduction confirmée lance le nettoyage en arrière-plan. Un gel global ou propre à un incident protège les preuves couvertes jusqu’à sa levée motivée par un administrateur.

## Puis-je en faire mon seul système de preuve en production ?

Non. Il s’agit d’une version en développement. Les sauvegardes sont lancées par l’opérateur, doivent être copiées hors hôte et exigent une reprise testée. Conservez d’autres registres opérationnels jusqu’à ce que la maturité du produit et votre procédure de reprise répondent à vos besoins.

## Quelle est la licence ?

La licence reste à définir. Le dépôt indique actuellement que tous les droits sont réservés ; ne supposez pas que la redistribution est permise. Vérifiez le dépôt avant tout usage dépassant l’évaluation.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>
