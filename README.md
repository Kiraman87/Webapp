# 📚 Gestionnaire de Prompts

Une application web moderne et intuitive pour **stocker, organiser, rechercher et réutiliser vos prompts** textuels. Idéale pour gérer vos prompts IA, scripts, modèles de textes et bien plus.

![Next.js](https://img.shields.io/badge/Next.js-14.2-black?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue?style=flat-square&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38bdf8?style=flat-square&logo=tailwind-css)
![React](https://img.shields.io/badge/React-18.3-61dafb?style=flat-square&logo=react)

## ✨ Fonctionnalités Principales

### 🎯 Gestion Complète des Prompts
- ✅ **Ajouter** de nouveaux prompts avec titre, description et contenu
- ✏️ **Modifier** vos prompts existants en toute simplicité
- 🗑️ **Supprimer** les prompts dont vous n'avez plus besoin
- 📋 **Copier** rapidement un prompt en un clic

### 🏷️ Organisation Intelligente
- 📁 **Catégories** : 7 catégories prédéfinies (IA, Développement, Marketing, etc.)
- 🏷️ **Tags** : Ajoutez des tags personnalisés pour une classification fine
- ⭐ **Favoris** : Marquez vos prompts essentiels comme favoris

### 🔍 Recherche & Filtrage Avancés
- 🔎 **Recherche textuelle** : Recherchez dans les titres, contenus, descriptions et tags
- 🎚️ **Filtres multiples** : Par catégorie, favoris, date de modification
- 📊 **Tri personnalisable** : Par date, titre ou catégorie (croissant/décroissant)
- 💨 **Résultats en temps réel** : Filtrage instantané pendant la saisie

### 💾 Import/Export
- 📤 **Export JSON** : Sauvegardez tous vos prompts au format JSON
- 📥 **Import JSON** : Restaurez ou partagez vos collections de prompts
- 🔒 **Données locales** : Tout est stocké localement dans votre navigateur

### 🎨 Interface Moderne
- 📱 **Responsive** : Interface optimisée pour mobile, tablette et desktop
- 🌈 **Design moderne** : Gradients, ombres et transitions fluides
- ✨ **Animations** : Transitions douces et animations subtiles
- 🎯 **UX optimale** : Navigation intuitive et ergonomique

## 🚀 Installation et Démarrage

### Prérequis
- Node.js 18.x ou supérieur
- npm, yarn ou pnpm

### Installation

```bash
# Cloner le repository
git clone <votre-repo>
cd Webapp

# Installer les dépendances
npm install
# ou
yarn install
# ou
pnpm install
```

### Lancement en développement

```bash
npm run dev
# ou
yarn dev
# ou
pnpm dev
```

Ouvrez [http://localhost:3000](http://localhost:3000) dans votre navigateur.

### Build de production

```bash
npm run build
npm run start
# ou
yarn build && yarn start
# ou
pnpm build && pnpm start
```

## 📂 Structure du Projet

```
Webapp/
├── app/                      # Pages Next.js (App Router)
│   ├── layout.tsx           # Layout principal de l'application
│   ├── page.tsx             # Page d'accueil avec la liste des prompts
│   └── globals.css          # Styles globaux et animations
├── components/              # Composants React réutilisables
│   ├── Header.tsx           # En-tête avec export/import
│   ├── SearchBar.tsx        # Barre de recherche et filtres
│   ├── PromptCard.tsx       # Carte d'affichage d'un prompt
│   └── PromptForm.tsx       # Formulaire modal d'ajout/modification
├── hooks/                   # Hooks React personnalisés
│   ├── useLocalStorage.ts   # Hook pour gérer le localStorage
│   └── usePrompts.ts        # Hook principal pour la gestion des prompts
├── types/                   # Définitions TypeScript
│   └── index.ts             # Types et interfaces
├── public/                  # Fichiers statiques
├── package.json             # Dépendances et scripts
├── tsconfig.json            # Configuration TypeScript
├── tailwind.config.ts       # Configuration Tailwind CSS
├── postcss.config.mjs       # Configuration PostCSS
└── next.config.js           # Configuration Next.js
```

## 🛠️ Technologies Utilisées

### Frontend
- **Next.js 14.2** - Framework React avec App Router
- **React 18.3** - Bibliothèque UI
- **TypeScript 5.4** - Typage statique
- **Tailwind CSS 3.4** - Framework CSS utility-first

### Icônes & UI
- **Lucide React** - Icônes modernes et élégantes

### Stockage
- **localStorage** - Stockage local côté navigateur

## 📖 Guide d'Utilisation

### Créer un Prompt

1. Cliquez sur le bouton **"Nouveau Prompt"** (ou le bouton **+** sur mobile)
2. Remplissez le formulaire :
   - **Titre** : Nom de votre prompt (requis)
   - **Description** : Brève description (optionnel)
   - **Contenu** : Le texte du prompt (requis)
   - **Catégorie** : Sélectionnez une catégorie (requis)
   - **Tags** : Ajoutez des tags pour l'organisation
   - **Favori** : Cochez pour marquer comme favori
3. Cliquez sur **"Créer le prompt"**

### Rechercher et Filtrer

1. Utilisez la **barre de recherche** pour rechercher dans tous les champs
2. Cliquez sur **"Filtres"** pour afficher les options avancées :
   - Filtrer par **catégorie**
   - Trier par **date**, **titre** ou **catégorie**
   - Basculer l'ordre croissant/décroissant
3. Cliquez sur l'icône **étoile** pour afficher uniquement les favoris

### Utiliser un Prompt

1. Trouvez votre prompt dans la liste
2. Cliquez sur **"Copier"** pour copier le contenu dans le presse-papiers
3. Le bouton affichera **"Copié !"** pendant 2 secondes

### Import/Export

#### Exporter vos prompts
1. Cliquez sur **"Exporter"** dans l'en-tête
2. Un fichier JSON sera téléchargé avec tous vos prompts

#### Importer des prompts
1. Cliquez sur **"Importer"** dans l'en-tête
2. Sélectionnez un fichier JSON valide
3. Vos prompts seront restaurés

## 🎨 Personnalisation

### Ajouter des Catégories

Éditez le fichier `types/index.ts` pour ajouter de nouvelles catégories :

```typescript
export const CATEGORIES_PAR_DEFAUT: Categorie[] = [
  { nom: 'Ma Nouvelle Catégorie', couleur: 'bg-pink-500' },
  // ... autres catégories
];
```

### Modifier les Couleurs

Les couleurs principales sont configurées dans `tailwind.config.ts`. Les gradients principaux utilisent :
- **Bleu** : `from-blue-600 to-purple-600`
- Personnalisez-les selon vos préférences !

## 🔐 Sécurité et Données

- ✅ **Données locales** : Tout est stocké dans le localStorage de votre navigateur
- ✅ **Aucun serveur** : Vos données ne quittent jamais votre appareil
- ✅ **Pas de cookies** : Aucun tracking ni cookies tiers
- ⚠️ **Attention** : Effacer les données du navigateur supprimera vos prompts (pensez à exporter !)

## 🚀 Déploiement

### Vercel (Recommandé)

```bash
# Installer Vercel CLI
npm i -g vercel

# Déployer
vercel
```

### Autres Plateformes

L'application peut être déployée sur n'importe quelle plateforme supportant Next.js :
- Netlify
- Railway
- AWS Amplify
- Azure Static Web Apps

## 📝 Scripts Disponibles

```bash
npm run dev      # Lancer en mode développement
npm run build    # Créer un build de production
npm run start    # Lancer le build de production
npm run lint     # Vérifier le code avec ESLint
```

## 🤝 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à :
1. Fork le projet
2. Créer une branche (`git checkout -b feature/AmazingFeature`)
3. Commit vos changements (`git commit -m 'Add some AmazingFeature'`)
4. Push vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrir une Pull Request

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier `LICENSE` pour plus de détails.

## 🙏 Remerciements

- [Next.js](https://nextjs.org/) - Le framework React
- [Tailwind CSS](https://tailwindcss.com/) - Le framework CSS
- [Lucide](https://lucide.dev/) - Les icônes
- [Vercel](https://vercel.com/) - Plateforme de déploiement

## 📧 Contact

Pour toute question ou suggestion, n'hésitez pas à ouvrir une issue sur GitHub.

---

**Fait avec ❤️ et TypeScript**