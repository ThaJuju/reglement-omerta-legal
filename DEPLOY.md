# Déploiement — Règlement Omerta Légal

Procédure complète pour mettre ce site en production sur un serveur neuf.
Document autoportant : tout ce qu'il faut savoir est ici, aucune connaissance
d'une session précédente n'est nécessaire.

---

## 1. Ce que tu déploies

Un site statique + un panel d'administration, servis par **un seul process Node
sans aucune dépendance npm** (ni build, ni `node_modules`, ni `package.json`).

| Élément | Rôle |
|---|---|
| `index.html`, `assets/` | page publique du règlement |
| `admin/` | panel staff (connexion + éditeur) |
| `server.js` | serveur HTTP : fichiers statiques + API JSON |
| `tools/staff.js` | CLI de gestion des comptes |
| `data/` | **état d'exécution, non versionné** |

Le contenu du règlement n'est pas dans le code : il vit dans
`data/content.json`, lu à chaque requête et réécrit par le panel.

**Prérequis** : Node 20+, PM2, git. Rien d'autre.

---

## 2. Choisir un port

Le port par défaut est **3007**. Vérifie qu'il est libre sur la machine cible,
sinon prends le premier port libre et note-le, il servira partout ensuite.

```bash
ss -ltn | awk 'NR>1{print $4}' | sed 's/.*://' | sort -nu | tr '\n' ' '
```

Si 3007 apparaît dans la liste, choisis-en un autre (3008, 3009…) et remplace-le
dans `ecosystem.config.js` **et** dans la configuration du reverse proxy.

---

## 3. Installation

```bash
cd /var/www
git clone https://github.com/ThaJuju/reglement-omerta-legal.git omerta-legal
cd omerta-legal
```

### Contenu de départ

`data/` est vide au clonage (hors la graine). Il faut créer le fichier de
contenu à partir de l'exemple fourni :

```bash
cp data/content.example.json data/content.json
```

> Si tu migres depuis un serveur existant, copie plutôt le `data/content.json`
> de l'ancienne machine : c'est le règlement à jour. Vérifie ensuite que le
> champ `rev` est un entier et que `sections` est un tableau non vide.

### Premier compte staff

```bash
node tools/staff.js add <identifiant>
```

Un mot de passe aléatoire est généré et affiché **une seule fois**. Transmets-le
par un canal privé ; la personne le changera depuis le panel.

Autres commandes : `passwd <identifiant>`, `del <identifiant>`, `list`.

### Permissions

```bash
chmod 700 data
chmod 600 data/users.json data/secret.key
```

`data/secret.key` est généré tout seul au premier démarrage s'il n'existe pas.
**Ne le régénère jamais sur un serveur en service** : cela invalide toutes les
sessions ouvertes.

---

## 4. Lancement sous PM2

```bash
pm2 start ecosystem.config.js
pm2 save
```

Le process s'appelle `omerta-legal`. Il écoute sur `0.0.0.0` par défaut —
change `HOST` en `127.0.0.1` dans `ecosystem.config.js` si un reverse proxy est
en place devant (recommandé, voir §5).

### Démarrage au boot

À faire **une seule fois par machine**, et seulement si aucune unité PM2
n'existe déjà (`systemctl is-enabled pm2-root`) :

```bash
pm2 startup systemd -u root --hp /root && pm2 save
```

Attention : cette commande affecte **tous** les process PM2 de la machine, pas
seulement celui-ci. Si d'autres applications tournent déjà sous PM2, confirme
avec le propriétaire du serveur avant de l'exécuter.

---

## 5. Reverse proxy et HTTPS

Le site fonctionne en HTTP nu, mais **deux fonctionnalités exigent HTTPS** :

- le cookie de session du panel circulerait en clair sans TLS ;
- `navigator.clipboard` (bouton « copier le lien de la section ») n'est
  disponible qu'en contexte sécurisé. Un repli existe et fonctionne en HTTP,
  mais le chemin propre ne s'active qu'en HTTPS.

**Ne mets pas le panel sur Internet sans TLS.**

### Apache

```apache
<VirtualHost *:443>
    ServerName reglement.exemple.fr

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/reglement.exemple.fr/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/reglement.exemple.fr/privkey.pem

    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:3007/
    ProxyPassReverse / http://127.0.0.1:3007/
</VirtualHost>
```

```bash
a2enmod proxy proxy_http ssl
apachectl configtest && systemctl reload apache2
```

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name reglement.exemple.fr;

    ssl_certificate     /etc/letsencrypt/live/reglement.exemple.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/reglement.exemple.fr/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3007;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Une fois le proxy en place, repasse `HOST` à `127.0.0.1` dans
`ecosystem.config.js` puis `pm2 restart omerta-legal --update-env`, pour que le
port ne soit plus joignable directement depuis le réseau.

---

## 6. Vérification

Remplace `$BASE` par l'URL publique (ou `http://127.0.0.1:3007` en local).

```bash
BASE=http://127.0.0.1:3007

curl -s -o /dev/null -w "page      %{http_code}\n" $BASE/
curl -s -o /dev/null -w "panel     %{http_code}\n" $BASE/admin/
curl -sL -o /dev/null -w "redirect  %{http_code}\n" $BASE/admin      # 200 après 301
curl -s $BASE/api/content | head -c 80; echo
```

Contrôles de sécurité — les trois premiers **doivent** échouer :

```bash
curl -s -o /dev/null -w "users.json  %{http_code}  (attendu 403)\n" $BASE/data/users.json
curl -s -o /dev/null -w "server.js   %{http_code}  (attendu 403)\n" $BASE/server.js
curl -s -o /dev/null -w "PUT anon    %{http_code}  (attendu 401)\n" -X PUT \
     -H 'Content-Type: application/json' -d '{}' $BASE/api/content
```

Test de connexion de bout en bout :

```bash
curl -s -c /tmp/ck -o /dev/null -w "login %{http_code}\n" -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"<identifiant>","password":"<motdepasse>"}' $BASE/api/login
curl -s -b /tmp/ck $BASE/api/me     # {"username":"..."}
rm -f /tmp/ck
```

Enfin, ouvre le panel dans un navigateur et enregistre une modification
triviale : la révision affichée en haut doit s'incrémenter, et la page publique
doit refléter le changement après un simple rafraîchissement.

---

## 7. Exploitation courante

```bash
pm2 logs omerta-legal          # journaux
pm2 restart omerta-legal       # uniquement après une modif de server.js
pm2 stop omerta-legal
```

Une modification faite depuis le panel est visible **immédiatement**, sans
redémarrage : le contenu est relu sur disque à chaque requête.

### Mise à jour du code

```bash
cd /var/www/omerta-legal
git pull
pm2 restart omerta-legal
```

`data/` étant ignoré par git, un `git pull` ne touche jamais au règlement ni aux
comptes. Aucune migration n'est nécessaire : le format de `content.json` est
stable.

### Sauvegardes

Le serveur conserve les 30 dernières versions dans `data/backups/`, créées
automatiquement avant chaque enregistrement, restaurables depuis le bouton
« Historique » du panel.

Pour une sauvegarde externe, seul `data/` compte :

```bash
tar czf reglement-$(date +%F).tar.gz -C /var/www/omerta-legal data
```

---

## 8. Pièges connus

| Symptôme | Cause | Correctif |
|---|---|---|
| `/admin` en 404 | ancienne version sans redirection de répertoire | `git pull` ; le serveur renvoie un 301 vers `/admin/` |
| Panel vide, console en erreur | `data/content.json` absent ou JSON invalide | recopier depuis `data/content.example.json` ou une sauvegarde |
| « Copie impossible » sur le bouton de lien | site en HTTP | normal, le repli prend le relais ; passer en HTTPS pour le chemin natif |
| Déconnexion permanente du panel | `data/secret.key` recréé | ne pas supprimer ce fichier ; se reconnecter |
| Enregistrement refusé en 409 | quelqu'un a sauvegardé entre-temps | recharger le panel, refaire la modification |
| Modifications non visibles | cache navigateur du CSS/JS (1 h) | `Ctrl+Shift+R` |
| Port déjà pris au démarrage | `EADDRINUSE` dans les logs PM2 | changer `PORT` dans `ecosystem.config.js` |

---

## 9. À ne pas faire

- Ne pas committer `data/` : il contient les comptes et la clé de session.
  Le `.gitignore` s'en charge, ne le desserre pas.
- Ne pas mettre de mot de passe en clair dans un fichier ou un commit.
  `tools/staff.js` accepte un mot de passe en argument, mais il finit dans
  l'historique du shell : préfère la génération automatique.
- Ne pas exposer le port Node directement sur Internet sans TLS devant.
- Ne pas éditer `data/content.json` à la main pendant qu'une session du panel
  est ouverte : le prochain enregistrement écraserait ta modification.
