'use client';

import { FilterOptions, Categorie } from '@/types';
import { Search, Filter, Star, X } from 'lucide-react';
import { useState } from 'react';

interface SearchBarProps {
  filtres: FilterOptions;
  onFiltresChange: (filtres: FilterOptions) => void;
  categories: Categorie[];
}

export default function SearchBar({ filtres, onFiltresChange, categories }: SearchBarProps) {
  const [showFilters, setShowFilters] = useState(false);

  const handleRechercheChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFiltresChange({ ...filtres, recherche: e.target.value });
  };

  const handleCategorieChange = (categorie: string) => {
    onFiltresChange({ ...filtres, categorie: categorie === filtres.categorie ? '' : categorie });
  };

  const toggleFavoriOnly = () => {
    onFiltresChange({ ...filtres, favoriOnly: !filtres.favoriOnly });
  };

  const handleSortChange = (sortBy: FilterOptions['sortBy']) => {
    onFiltresChange({
      ...filtres,
      sortBy,
      sortOrder: filtres.sortBy === sortBy && filtres.sortOrder === 'desc' ? 'asc' : 'desc',
    });
  };

  const resetFilters = () => {
    onFiltresChange({
      recherche: '',
      categorie: '',
      favoriOnly: false,
      sortBy: 'dateModification',
      sortOrder: 'desc',
    });
  };

  const activeFiltersCount = [
    filtres.categorie !== '',
    filtres.favoriOnly,
    filtres.sortBy !== 'dateModification' || filtres.sortOrder !== 'desc',
  ].filter(Boolean).length;

  return (
    <div className="bg-white rounded-xl shadow-md p-4 mb-6 animate-fade-in">
      {/* Barre de recherche principale */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Rechercher dans les prompts, tags, descriptions..."
            value={filtres.recherche}
            onChange={handleRechercheChange}
            className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-4 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 ${
            showFilters || activeFiltersCount > 0
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <Filter size={20} />
          <span className="hidden sm:inline">Filtres</span>
          {activeFiltersCount > 0 && (
            <span className="bg-white text-blue-600 px-2 py-0.5 rounded-full text-xs font-bold">
              {activeFiltersCount}
            </span>
          )}
        </button>
        <button
          onClick={toggleFavoriOnly}
          className={`px-4 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 ${
            filtres.favoriOnly
              ? 'bg-yellow-500 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          title="Afficher uniquement les favoris"
        >
          <Star size={20} fill={filtres.favoriOnly ? 'currentColor' : 'none'} />
          <span className="hidden sm:inline">Favoris</span>
        </button>
      </div>

      {/* Panneau de filtres */}
      {showFilters && (
        <div className="border-t border-gray-200 pt-4 animate-slide-up">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Filtres avancés</h3>
            {activeFiltersCount > 0 && (
              <button
                onClick={resetFilters}
                className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1"
              >
                <X size={16} />
                Réinitialiser
              </button>
            )}
          </div>

          {/* Catégories */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Catégories</label>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.nom}
                  onClick={() => handleCategorieChange(cat.nom)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    filtres.categorie === cat.nom
                      ? 'bg-blue-600 text-white scale-105'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {cat.nom}
                </button>
              ))}
            </div>
          </div>

          {/* Tri */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Trier par</label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'dateModification', label: 'Date de modification' },
                { value: 'titre', label: 'Titre' },
                { value: 'categorie', label: 'Catégorie' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleSortChange(option.value as FilterOptions['sortBy'])}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    filtres.sortBy === option.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {option.label} {filtres.sortBy === option.value && (filtres.sortOrder === 'asc' ? '↑' : '↓')}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
