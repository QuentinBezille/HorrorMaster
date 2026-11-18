# Horror Master

```
index.html          structure de la page
css/style.css       apparence
js/config.js        URL et clé publique Supabase (à remplir)
js/utils.js         petits outils ($, el, ...)
js/cartes.js        grille de cartes, filtres, tri, fiche détaillée
js/joueur.js        connexion, boosters, collection
js/main.js          démarrage
sql/                tables et fonctions à exécuter dans Supabase
scripts/            script Python qui remplit la table cards
```

Lancer en local : `py -m http.server 8000` dans ce dossier, puis http://localhost:8000
(Ctrl+F5 si le navigateur garde une ancienne version d'un fichier.)

Ordre des fichiers JS dans index.html : config, utils, cartes, joueur, main.
