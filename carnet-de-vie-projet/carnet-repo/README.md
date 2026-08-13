# Mon carnet de vie

Carnet personnel et professionnel : habitudes quotidiennes, calendrier, finances,
objectifs, enseignement, cours particuliers, commercial et études.

Les données sont enregistrées dans une base Postgres (Netlify Database) et
protégées par un code d'accès. Un seul utilisateur.

---

## Mise en route (à faire une seule fois)

### 1. Connecter ce dépôt à Netlify

Sur https://app.netlify.com → **Add new project** → **Import an existing project**
→ **GitHub** → choisir le dépôt `carnet-de-vie`.

Les réglages sont déjà dans `netlify.toml`, il n'y a rien à modifier.
Cliquer sur **Deploy**.

> Si un site `cdvhanni` existe déjà : ouvrir ce site → **Project configuration**
> → **Build & deploy** → **Link repository**, et choisir ce dépôt.
> L'adresse `cdvhanni.netlify.app` reste inchangée.

### 2. Définir le code d'accès

Dans Netlify : **Project configuration** → **Environment variables** → **Add a variable**

| Nom        | Valeur                                            |
|------------|---------------------------------------------------|
| `APP_PIN`  | le code d'accès souhaité (chiffres, 6 recommandé) |
| `PIN_SALT` | une longue phrase aléatoire, jamais partagée       |

`APP_PIN` sert uniquement à la toute première connexion. Ensuite le code est
conservé (sous forme d'empreinte) dans la base, et se change depuis
l'application : **Réglages → Modifier le code**.

`PIN_SALT` protège l'empreinte du code. Une fois définie, ne plus la modifier :
cela invaliderait le code enregistré.

### 3. Redéployer

**Deploys** → **Trigger deploy** → **Deploy site**.
La base de données est créée automatiquement et les tables installées au premier
déploiement.

---

## Sécurité

- Le code d'accès n'est jamais stocké en clair : seule une empreinte l'est.
- Toutes les données exigent une session valide, vérifiée côté serveur.
- Après 8 codes erronés, l'accès se bloque 15 minutes.
- Une session reste ouverte 60 jours, sauf déconnexion via **Réglages →
  Verrouiller la session**.
- Changer le code déconnecte tous les autres appareils.

## Installation sur téléphone

Ouvrir l'adresse du site, puis :
- **iPhone (Safari)** : Partager → *Sur l'écran d'accueil*
- **Android (Chrome)** : menu ⋮ → *Ajouter à l'écran d'accueil*

## Structure

```
public/index.html                          interface complète
netlify/functions/api.mjs                  authentification + accès base
netlify/database/migrations/001_init/      création des tables
netlify.toml                               configuration Netlify
```

## Sauvegarde

Les données vivent dans la base Netlify. Une copie manuelle est possible via
l'onglet **Database** du tableau de bord Netlify.
