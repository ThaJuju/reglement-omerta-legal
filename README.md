# Omerta — Règlement Légal

Site statique (aucune dépendance, aucun build) présentant uniquement le règlement
du **pôle Légal** : entreprises, métiers, services publics et forces de l'ordre.

## Fichiers

```
index.html            page unique
assets/style.css      thème sombre (violet / or), responsive + feuille d'impression
assets/app.js         sommaire, recherche, accordéons, ancres, raccourcis
admin/                panel staff (connexion + éditeur complet)
server.js             serveur statique + API
tools/staff.js        gestion des comptes
data/                 contenu, comptes, sauvegardes (non servi en HTTP)
```

## Installation

Node 20+, aucune dépendance à installer.
Pour une mise en production complète (reverse proxy, HTTPS, vérifications,
pièges connus) : voir **[DEPLOY.md](DEPLOY.md)**.

```bash
git clone git@github.com:ThaJuju/reglement-omerta-legal.git
cd reglement-omerta-legal
cp data/content.example.json data/content.json   # contenu de départ
node tools/staff.js add <identifiant>            # premier compte staff
pm2 start ecosystem.config.js && pm2 save
```

`data/` n'est pas versionné : il contient le règlement en cours d'édition, les
comptes, la clé de session et les sauvegardes. Seul `data/content.example.json`
sert de graine.

## Modifier le règlement

Tout passe par le **panel staff** : `http://<serveur>:3007/admin/`
(lien « Staff » discret en pied de page du site).

- **Onglet Règlement** — sommaire à gauche (glisser-déposer pour réordonner,
  ajouter, dupliquer, supprimer une section), éditeur à droite : emoji, titre,
  puis chaque ligne avec son type, son texte et sa poignée de déplacement.
- **Onglet Textes du site** — nom, logo, sous-titre, bandeau d'accueil,
  description, lien Discord, version, pied de page, placeholder de recherche.
- **Enregistrer** (ou `Ctrl+S`) publie immédiatement : le site public lit la
  même source.
- **Historique** — une sauvegarde est prise avant chaque enregistrement
  (30 conservées), restaurables en un clic.

Types de ligne disponibles :

| Type | Rendu |
|---|---|
| `• Règle` | puce violette, la ligne standard |
| `◦ Sous-point` | puce grise indentée |
| `Intitulé` | titre de sous-partie en doré |
| `Encadré info` | bloc violet |
| `Encadré alerte` | bloc rouge |

`**texte**` met en gras dans n'importe quelle ligne.

### Comptes staff

```bash
node tools/staff.js add <identifiant> [motdepasse]     # créer
node tools/staff.js passwd <identifiant> [motdepasse]  # réinitialiser
node tools/staff.js del <identifiant>                  # supprimer
node tools/staff.js list                               # lister
```

Sans mot de passe fourni, un mot de passe aléatoire est généré et affiché.
Chaque membre peut ensuite changer le sien depuis le panel.

### Données

| Fichier | Contenu |
|---|---|
| `data/content.json` | le règlement + les textes du site (source de vérité) |
| `data/users.json` | comptes staff (scrypt + sel, jamais en clair) |
| `data/secret.key` | clé de signature des sessions |
| `data/backups/` | 30 dernières versions |

Le dossier `data/` n'est jamais servi en HTTP. Éditer `content.json` à la main
reste possible (le serveur le relit à chaque requête), mais le panel est plus sûr.

## Personnaliser

- **Nom, logo, lien Discord, textes** : onglet « Textes du site » du panel.
- **Couleurs** : variables `:root` en haut de `assets/style.css`.

## Fonctionnalités

- Sommaire latéral collant avec surlignage de la section courante (drawer sur mobile)
- Recherche instantanée, insensible aux accents, avec surlignage des résultats
- Sections repliables, « Tout déplier », lien direct copiable par section (`#ancre`)
- Raccourcis : `/` pour chercher, `Échap` pour effacer
- Bouton « Imprimer » qui déplie tout et produit un PDF propre en noir sur blanc

## Mise en ligne

Purement statique : servir le dossier tel quel (nginx, Apache, GitHub Pages…).

```bash
python3 -m http.server 8080
```

## Déploiement PM2

Le site tourne sous PM2 via un petit serveur statique Node sans dépendance
(`server.js`), déclaré dans `ecosystem.config.js`.

- **Nom du process** : `omerta-legal`
- **Port** : `3007` (3000→3006 étaient déjà pris)
- **Écoute** : `0.0.0.0` — modifiable via `HOST` / `PORT` dans `ecosystem.config.js`

```bash
pm2 restart omerta-legal      # uniquement après une modif de server.js
pm2 logs omerta-legal
pm2 stop omerta-legal
```

Le contenu est lu sur disque à chaque requête : un enregistrement depuis le
panel est visible immédiatement, sans `pm2 restart`.

### Démarrage auto au boot

Pas encore configuré sur cette machine (aucune unité `pm2-root`) :

```bash
pm2 startup systemd -u root --hp /root && pm2 save
```
