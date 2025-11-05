import { useState, useMemo } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { Prompt, Categorie, FilterOptions, CATEGORIES_PAR_DEFAUT } from '@/types';

export function usePrompts() {
  const [prompts, setPrompts] = useLocalStorage<Prompt[]>('prompts', []);
  const [categories, setCategories] = useLocalStorage<Categorie[]>('categories', CATEGORIES_PAR_DEFAUT);
  const [filtres, setFiltres] = useState<FilterOptions>({
    recherche: '',
    categorie: '',
    favoriOnly: false,
    sortBy: 'dateModification',
    sortOrder: 'desc',
  });

  // Fonction pour ajouter un prompt
  const ajouterPrompt = (prompt: Omit<Prompt, 'id' | 'dateCreation' | 'dateModification'>) => {
    const nouveauPrompt: Prompt = {
      ...prompt,
      id: Date.now().toString(),
      dateCreation: new Date().toISOString(),
      dateModification: new Date().toISOString(),
    };
    setPrompts([...prompts, nouveauPrompt]);
    return nouveauPrompt;
  };

  // Fonction pour modifier un prompt
  const modifierPrompt = (id: string, updates: Partial<Prompt>) => {
    setPrompts(prompts.map(p =>
      p.id === id
        ? { ...p, ...updates, dateModification: new Date().toISOString() }
        : p
    ));
  };

  // Fonction pour supprimer un prompt
  const supprimerPrompt = (id: string) => {
    setPrompts(prompts.filter(p => p.id !== id));
  };

  // Fonction pour basculer le favori
  const toggleFavori = (id: string) => {
    setPrompts(prompts.map(p =>
      p.id === id ? { ...p, favori: !p.favori } : p
    ));
  };

  // Fonction pour ajouter une catégorie
  const ajouterCategorie = (categorie: Categorie) => {
    if (!categories.find(c => c.nom === categorie.nom)) {
      setCategories([...categories, categorie]);
    }
  };

  // Fonction d'export
  const exporterPrompts = () => {
    const data = {
      prompts,
      categories,
      dateExport: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prompts-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Fonction d'import
  const importerPrompts = (file: File) => {
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          if (data.prompts && Array.isArray(data.prompts)) {
            setPrompts(data.prompts);
          }
          if (data.categories && Array.isArray(data.categories)) {
            setCategories(data.categories);
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  // Filtrage et tri des prompts
  const promptsFiltres = useMemo(() => {
    let resultat = [...prompts];

    // Filtrer par recherche
    if (filtres.recherche) {
      const rechercheLower = filtres.recherche.toLowerCase();
      resultat = resultat.filter(p =>
        p.titre.toLowerCase().includes(rechercheLower) ||
        p.contenu.toLowerCase().includes(rechercheLower) ||
        p.description?.toLowerCase().includes(rechercheLower) ||
        p.tags.some(tag => tag.toLowerCase().includes(rechercheLower))
      );
    }

    // Filtrer par catégorie
    if (filtres.categorie) {
      resultat = resultat.filter(p => p.categorie === filtres.categorie);
    }

    // Filtrer par favoris
    if (filtres.favoriOnly) {
      resultat = resultat.filter(p => p.favori);
    }

    // Trier
    resultat.sort((a, b) => {
      let comparaison = 0;
      switch (filtres.sortBy) {
        case 'titre':
          comparaison = a.titre.localeCompare(b.titre);
          break;
        case 'categorie':
          comparaison = a.categorie.localeCompare(b.categorie);
          break;
        case 'dateModification':
        default:
          comparaison = new Date(a.dateModification).getTime() - new Date(b.dateModification).getTime();
      }
      return filtres.sortOrder === 'asc' ? comparaison : -comparaison;
    });

    return resultat;
  }, [prompts, filtres]);

  return {
    prompts,
    promptsFiltres,
    categories,
    filtres,
    setFiltres,
    ajouterPrompt,
    modifierPrompt,
    supprimerPrompt,
    toggleFavori,
    ajouterCategorie,
    exporterPrompts,
    importerPrompts,
  };
}
