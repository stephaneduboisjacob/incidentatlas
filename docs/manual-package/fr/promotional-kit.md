# Kit promotionnel

Les textes ci-dessous décrivent la version actuelle, encore en développement. Conservez le périmètre et les limites lors de leur adaptation : ne promettez ni connecteurs non livrés, ni découverte automatique de cause racine, ni disponibilité pour la production.

## Présentation du produit

**IncidentAtlas est un enregistreur de changements opérationnels auto-hébergeable pour les enquêtes sur incident.** Il construit une chronologie vérifiable des changements autour d’une panne, rattache les suggestions aux événements sources et laisse les décisions causales aux personnes qui enquêtent.

## Page d’accueil

### Titre

**Quand la production tombe, voyez ce qui a changé.**

### Sous-titre

Reconstituez la chronologie opérationnelle d’une panne à partir de changements compacts, conçus pour limiter les données, et de suggestions explicables reliées aux preuves. Gardez vos données dans votre propre installation.

### Points clés

- Suivez les changements des services Linux et des sources hôtes prises en charge.
- Examinez l’heure, la ressource, l’état avant/après et l’empreinte d’intégrité dans une même chronologie.
- Comprenez pourquoi un événement est suggéré et ouvrez la preuve correspondante.
- Conservez les notes d’enquête ; seule une personne peut confirmer une hypothèse.
- Choisissez une file de collecte bornée et les modes `dry-run`, `local` ou `connected`.
- Auto-hébergez avec PostgreSQL et un stockage local d’artefacts ; la corrélation déterministe ne nécessite pas d’IA.

### Appel à l’action

**Découvrir la version en développement** · **Lire le guide de déploiement**

## Descriptions courtes

- **En une phrase :** IncidentAtlas aide les petites équipes d’infrastructure à reconstituer ce qui a changé avant une panne, en rattachant chaque explication suggérée à ses preuves.
- **Annuaire :** Une chronologie des changements Linux auto-hébergeable pour reconstituer les incidents à partir de preuves.
- **Profil social :** Changements opérationnels, chronologies d’incident et preuves consultables. Auto-hébergé. Vérifié par des personnes.

## Publication de lancement

Nous construisons IncidentAtlas, un enregistreur de changements auto-hébergeable pour les heures difficiles qui suivent une panne. Il regroupe les changements opérationnels pris en charge dans une chronologie, explique pourquoi certains événements peuvent être pertinents et renvoie chaque suggestion à ses preuves. L’objectif est de reconstruire plus vite et plus fiablement, pas d’ajouter un autre flux de journaux. Le projet est en développement ; le premier périmètre couvre un petit ensemble Linux/systemd/Docker/Nginx.

## Recommandations éditoriales

Préférez **hypothèse**, **contributeur possible**, **preuve à l’appui** et **confirmé par une personne**. Évitez « l’IA a trouvé la cause racine », les promesses de temps de rétablissement et les affirmations selon lesquelles tous les connecteurs prévus sont déjà disponibles. Indiquez que le produit est encore en développement et que la licence reste à définir avant toute redistribution.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>
