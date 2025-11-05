'use client';

import { Prompt } from '@/types';
import { Star, Copy, Edit2, Trash2, Tag, Calendar } from 'lucide-react';
import { useState } from 'react';

interface PromptCardProps {
  prompt: Prompt;
  onToggleFavori: () => void;
  onModifier: () => void;
  onSupprimer: () => void;
}

export default function PromptCard({ prompt, onToggleFavori, onModifier, onSupprimer }: PromptCardProps) {
  const [copie, setCopie] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const copierPrompt = () => {
    navigator.clipboard.writeText(prompt.contenu);
    setCopie(true);
    setTimeout(() => setCopie(false), 2000);
  };

  const getCouleurCategorie = () => {
    const couleurs: { [key: string]: string } = {
      'IA & Machine Learning': 'bg-blue-100 text-blue-800 border-blue-200',
      'Développement': 'bg-green-100 text-green-800 border-green-200',
      'Marketing': 'bg-purple-100 text-purple-800 border-purple-200',
      'Rédaction': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'Productivité': 'bg-red-100 text-red-800 border-red-200',
      'Analyse': 'bg-indigo-100 text-indigo-800 border-indigo-200',
      'Autre': 'bg-gray-100 text-gray-800 border-gray-200',
    };
    return couleurs[prompt.categorie] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <div className="bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-100 animate-scale-in">
      <div className="p-5">
        {/* En-tête */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{prompt.titre}</h3>
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
              <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getCouleurCategorie()}`}>
                {prompt.categorie}
              </span>
              <span className="flex items-center gap-1">
                <Calendar size={14} />
                {formatDate(prompt.dateModification)}
              </span>
            </div>
          </div>
          <button
            onClick={onToggleFavori}
            className={`p-2 rounded-lg transition-all duration-200 ${
              prompt.favori
                ? 'text-yellow-500 bg-yellow-50 hover:bg-yellow-100'
                : 'text-gray-400 hover:text-yellow-500 hover:bg-yellow-50'
            }`}
            title={prompt.favori ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          >
            <Star size={20} fill={prompt.favori ? 'currentColor' : 'none'} />
          </button>
        </div>

        {/* Description */}
        {prompt.description && (
          <p className="text-sm text-gray-600 mb-3">{prompt.description}</p>
        )}

        {/* Contenu */}
        <div className="relative">
          <div
            className={`bg-gray-50 rounded-lg p-4 mb-3 border border-gray-200 ${
              expanded ? '' : 'max-h-24 overflow-hidden'
            }`}
          >
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">{prompt.contenu}</pre>
          </div>
          {prompt.contenu.length > 150 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              {expanded ? 'Voir moins' : 'Voir plus...'}
            </button>
          )}
        </div>

        {/* Tags */}
        {prompt.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {prompt.tags.map((tag, index) => (
              <span
                key={index}
                className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-xs"
              >
                <Tag size={12} />
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-3 border-t border-gray-100">
          <button
            onClick={copierPrompt}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 font-medium"
          >
            <Copy size={16} />
            {copie ? 'Copié !' : 'Copier'}
          </button>
          <button
            onClick={onModifier}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors duration-200"
            title="Modifier"
          >
            <Edit2 size={16} />
          </button>
          <button
            onClick={onSupprimer}
            className="px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors duration-200"
            title="Supprimer"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
