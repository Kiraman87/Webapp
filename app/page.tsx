'use client';

import { useState, useRef } from 'react';
import { usePrompts } from '@/hooks/usePrompts';
import Header from '@/components/Header';
import SearchBar from '@/components/SearchBar';
import PromptCard from '@/components/PromptCard';
import PromptForm from '@/components/PromptForm';
import { Plus, FileText, Sparkles } from 'lucide-react';
import { Prompt } from '@/types';

export default function Home() {
  const {
    promptsFiltres,
    categories,
    filtres,
    setFiltres,
    ajouterPrompt,
    modifierPrompt,
    supprimerPrompt,
    toggleFavori,
    exporterPrompts,
    importerPrompts,
    prompts,
  } = usePrompts();

  const [showForm, setShowForm] = useState(false);
  const [promptAModifier, setPromptAModifier] = useState<Prompt | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSavePrompt = (data: Omit<Prompt, 'id' | 'dateCreation' | 'dateModification'>) => {
    if (promptAModifier) {
      modifierPrompt(promptAModifier.id, data);
    } else {
      ajouterPrompt(data);
    }
    setShowForm(false);
    setPromptAModifier(undefined);
  };

  const handleModifier = (prompt: Prompt) => {
    setPromptAModifier(prompt);
    setShowForm(true);
  };

  const handleSupprimer = (id: string) => {
    if (confirm('Êtes-vous sûr de vouloir supprimer ce prompt ?')) {
      supprimerPrompt(id);
    }
  };

  const handleImporter = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        await importerPrompts(file);
        alert('Import réussi !');
      } catch (error) {
        alert('Erreur lors de l\'import. Vérifiez que le fichier est valide.');
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleNouveauPrompt = () => {
    setPromptAModifier(undefined);
    setShowForm(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50">
      <Header
        onExporter={exporterPrompts}
        onImporter={handleImporter}
        totalPrompts={prompts.length}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />

      <main className="container mx-auto px-4 py-8">
        {/* Bouton d'ajout flottant pour mobile */}
        <button
          onClick={handleNouveauPrompt}
          className="fixed bottom-6 right-6 z-40 md:hidden bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4 rounded-full shadow-2xl hover:shadow-3xl transition-all duration-200 hover:scale-110"
        >
          <Plus size={28} />
        </button>

        {/* Bouton d'ajout pour desktop */}
        <div className="hidden md:flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <Sparkles className="text-blue-600" size={28} />
            <h2 className="text-2xl font-bold text-gray-800">
              Mes Prompts
              <span className="text-sm font-normal text-gray-500 ml-3">
                {promptsFiltres.length} prompt{promptsFiltres.length > 1 ? 's' : ''} affiché{promptsFiltres.length > 1 ? 's' : ''}
              </span>
            </h2>
          </div>
          <button
            onClick={handleNouveauPrompt}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-200 font-medium shadow-lg hover:shadow-xl hover:scale-105"
          >
            <Plus size={20} />
            Nouveau Prompt
          </button>
        </div>

        {/* Barre de recherche */}
        <SearchBar
          filtres={filtres}
          onFiltresChange={setFiltres}
          categories={categories}
        />

        {/* Liste des prompts */}
        {promptsFiltres.length === 0 ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-24 h-24 bg-gray-100 rounded-full mb-6">
              <FileText size={48} className="text-gray-400" />
            </div>
            <h3 className="text-2xl font-semibold text-gray-700 mb-3">
              {prompts.length === 0
                ? 'Aucun prompt enregistré'
                : 'Aucun prompt ne correspond à vos critères'}
            </h3>
            <p className="text-gray-500 mb-6 max-w-md mx-auto">
              {prompts.length === 0
                ? 'Commencez par créer votre premier prompt pour organiser vos textes et modèles.'
                : 'Essayez de modifier vos filtres ou votre recherche pour voir plus de résultats.'}
            </p>
            {prompts.length === 0 && (
              <button
                onClick={handleNouveauPrompt}
                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-200 font-medium shadow-lg hover:shadow-xl"
              >
                <Plus size={20} />
                Créer mon premier prompt
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {promptsFiltres.map((prompt) => (
              <PromptCard
                key={prompt.id}
                prompt={prompt}
                onToggleFavori={() => toggleFavori(prompt.id)}
                onModifier={() => handleModifier(prompt)}
                onSupprimer={() => handleSupprimer(prompt.id)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Formulaire modal */}
      {showForm && (
        <PromptForm
          prompt={promptAModifier}
          categories={categories}
          onSave={handleSavePrompt}
          onCancel={() => {
            setShowForm(false);
            setPromptAModifier(undefined);
          }}
        />
      )}
    </div>
  );
}
