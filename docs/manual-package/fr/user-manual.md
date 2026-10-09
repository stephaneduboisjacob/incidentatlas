# Manuel utilisateur

## Rôle d’IncidentAtlas

IncidentAtlas enregistre des changements opérationnels compacts et les replace autour d’un incident afin d’aider une personne à examiner ce qui a changé, quand et quelles preuves étayent une explication possible. Les suggestions actuelles reposent sur un score déterministe. Une suggestion est une hypothèse, jamais une attribution automatique de cause.

## Connexion et espace de travail

Ouvrez l’adresse HTTPS IncidentAtlas de votre organisation et connectez-vous avec le compte créé lors de l’initialisation. Si vous n’avez pas de compte, contactez un propriétaire ou un administrateur : la version actuelle ne propose ni invitation en libre-service ni écran de gestion des utilisateurs. Cliquez sur **Sign out** avant de quitter un poste partagé.

La vue d’ensemble présente les incidents ouverts, les changements récents, les hôtes visibles dans la vue et l’état général de l’ingestion. Cliquez sur **Refresh** pour actualiser. Un hôte apparaît lorsque le serveur accepte un événement de son collecteur.

## Examiner la chronologie

Choisissez **All recent events** pour consulter les événements récents, ou sélectionnez un incident afin d’afficher sa fenêtre temporelle. Par défaut, elle couvre les 60 minutes avant et les 30 minutes après le début de l’incident. Sélectionnez un hôte et une catégorie pour réduire la liste. Les heures affichées suivent le fuseau du navigateur ; les heures enregistrées sont en UTC.

Cliquez sur une ligne pour ouvrir **Evidence detail**. Examinez la source, la ressource, le type de changement, la sévérité, les états avant/après, les facteurs de corrélation et le condensat SHA-256 de l’événement. Le condensat aide à vérifier l’intégrité ; il ne prouve pas que l’hôte source était fiable. Certains événements ne contiennent que des métadonnées ou des empreintes, sans copie de configuration.

## Déclarer un incident

Cliquez sur **Declare incident** et indiquez un titre précis, l’heure de début, la sévérité et les noms des services affectés. Choisissez l’heure de début des symptômes, et non celle à laquelle quelqu’un a ouvert IncidentAtlas. Les noms de services aident le moteur à repérer les ressources correspondantes. Créez la fenêtre puis examinez les événements autour de celle-ci.

La version MVP ne fournit pas encore un éditeur complet du cycle de vie d’un incident. Consignez le contexte avec des notes et le retour sur les hypothèses ; la gestion des statuts reste limitée.

## Évaluer les contributeurs possibles

Cliquez sur **Analyze incident window**. IncidentAtlas classe les preuves à l’aide de facteurs visibles : proximité temporelle, correspondance avec un service affecté, importance du type d’événement et vocabulaire de symptôme. Le moteur actuel est déterministe et n’utilise pas de LLM. Le score sert à prioriser, ce n’est pas une probabilité.

Ouvrez l’événement lié avant de juger. Choisissez **Investigate**, **Reject** ou **Confirm** seulement si les éléments disponibles justifient cette décision. **Confirm** enregistre le statut `confirmed_by_human` ; c’est la seule action qui marque une cause comme confirmée par une personne. Ajoutez une note à l’événement pour préserver votre interprétation. Un score faible ou l’absence d’hypothèse ne prouve pas qu’aucune cause n’existe.

## Préparer un postmortem

Dans un incident, choisissez **Download deterministic postmortem draft**. Le fichier Markdown résume l’incident et rattache ses affirmations aux identifiants d’événements et aux condensats de preuve. Il s’agit d’un brouillon : vérifiez chaque affirmation, ajoutez l’impact client et les actions correctives, et distinguez les faits confirmés des questions ouvertes avant diffusion.

## Disponibilité des preuves

Les événements et les artefacts ont des durées de conservation distinctes. Un artefact expiré peut rester visible sous forme de métadonnées sans être téléchargeable. Si une enquête exige de conserver des preuves, demandez à un propriétaire ou administrateur d’activer une conservation juridique avant l’expiration. Ne copiez pas de pièces sensibles vers un emplacement non approuvé.

## Bonnes pratiques d’enquête

Commencez par l’heure du symptôme et le service affecté. Comparez les changements avant et après, inspectez les preuves sources et recherchez aussi les éléments contradictoires. Notez les incertitudes. Les horodatages, l’identité de l’hôte et les événements peuvent être incomplets ou affectés par un hôte compromis.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>
