export interface Prompt {
  id: string;
  titre: string;
  contenu: string;
  description?: string;
  categorie: string;
  tags: string[];
  favori: boolean;
  dateCreation: string;
  dateModification: string;
}

export interface Categorie {
  nom: string;
  couleur: string;
}

export interface FilterOptions {
  recherche: string;
  categorie: string;
  favoriOnly: boolean;
  sortBy: 'dateModification' | 'titre' | 'categorie';
  sortOrder: 'asc' | 'desc';
}

export interface AppState {
  prompts: Prompt[];
  categories: Categorie[];
  filtres: FilterOptions;
}

export const CATEGORIES_PAR_DEFAUT: Categorie[] = [
  { nom: 'IA & Machine Learning', couleur: 'bg-blue-500' },
  { nom: 'Développement', couleur: 'bg-green-500' },
  { nom: 'Marketing', couleur: 'bg-purple-500' },
  { nom: 'Rédaction', couleur: 'bg-yellow-500' },
  { nom: 'Productivité', couleur: 'bg-red-500' },
  { nom: 'Analyse', couleur: 'bg-indigo-500' },
  { nom: 'Autre', couleur: 'bg-gray-500' },
];
