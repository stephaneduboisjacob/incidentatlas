# Sécurité et confidentialité

## Engagement de collecte

IncidentAtlas vise à préserver des changements d’état compacts utiles à la reconstitution. Avant l’envoi en mode connecté, le collecteur applique le masquage. Les sources actuellement prises en charge sont les événements structurés de cycle de vie systemd, les métadonnées d’événements de conteneurs Docker si activées, et les empreintes de fichiers Nginx explicitement configurés. Le collecteur n’envoie pas le texte des messages du journal, les variables d’environnement Docker, les journaux de conteneur, le contenu des fichiers Nginx, le texte ou les paramètres SQL, les charges utiles applicatives, les clés privées ni le code source des dépôts.

Il s’agit d’un objectif de conception, pas d’une garantie que chaque hôte ou source personnalisée est sans risque. Examinez la sortie en `dry-run`, limitez les sources et ajoutez des règles locales pour les identifiants sensibles si nécessaire.

## Classes de données

| Classe | Exemples | Traitement |
| --- | --- | --- |
| PUBLIC | Version publiée du logiciel | Peut être partagée |
| OPERATIONAL | État de service, empreinte d’image, expiration de certificat | Enregistrement opérationnel contrôlé par le locataire |
| SENSITIVE | Noms d’hôtes, chemins, identifiants utilisateur | Minimiser, restreindre l’accès, appliquer la conservation |
| SECRET | Mots de passe, jetons, clés privées, cookies | Masquer localement ; ne jamais persister intentionnellement |
| PROHIBITED | Données clients, lignes de tables, contenu de clés privées | Ne pas collecter |

## Mesures pour les opérateurs

- Utilisez `dry-run`, puis `local`, puis `connected`.
- Faites tourner l’agent sous son compte non privilégié et accordez-lui le minimum d’accès. Laissez Docker désactivé, sauf si vous acceptez le privilège équivalent à root.
- Utilisez HTTPS avec vérification du certificat ; ne désactivez pas les contrôles TLS.
- Protégez les jetons de configuration initiale, les identifiants de collecteur, `.env`, les sauvegardes et les données.
- Gardez PostgreSQL privé et l’API publique derrière HTTPS.
- Examinez les métadonnées d’événements et les chemins surveillés avant d’activer la collecte.
- Chiffrez les sauvegardes, copiez-les hors hôte et testez-les. La collecte connectée sur un hôte surveillé doit attendre que les copies de reprise et procédures soient vérifiées.
- Choisissez soigneusement les durées de conservation et les gels juridiques. Une réduction confirmée peut supprimer des preuves de façon asynchrone.

## Accès, intégrité et limites

Les requêtes API imposent le cloisonnement par organisation. Les identifiants des collecteurs sont stockés sous forme de condensats et peuvent être révoqués. Les événements ont une empreinte SHA-256 ; les artefacts sont adressés par contenu et vérifiés lors des opérations de nettoyage/sauvegarde. Une empreinte révèle certaines modifications des octets stockés ; elle ne prouve pas la véracité d’un événement provenant d’un hôte compromis. L’horloge d’un hôte peut être fausse, un collecteur peut être hors ligne, et l’absence d’événement ne prouve pas qu’aucun changement n’a eu lieu.

La télémétrie produit est désactivée par défaut. Le MVP actuel ne comprend pas d’interface complète de gestion des comptes, de fournisseur d’identité externe, de source PostgreSQL, de captures complètes de configuration, de sauvegarde hors hôte automatisée ni d’analyse causale par IA. Consultez `docs/threat-model.md`, `docs/privacy.md` et `SECURITY.md` pour les hypothèses détaillées et le signalement de vulnérabilités.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>
