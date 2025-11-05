'use client';

import { BookOpen, Download, Upload } from 'lucide-react';

interface HeaderProps {
  onExporter: () => void;
  onImporter: () => void;
  totalPrompts: number;
}

export default function Header({ onExporter, onImporter, totalPrompts }: HeaderProps) {
  return (
    <header className="bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-3 rounded-xl backdrop-blur-sm">
              <BookOpen size={32} />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">Gestionnaire de Prompts</h1>
              <p className="text-blue-100 text-sm mt-1">
                {totalPrompts} prompt{totalPrompts > 1 ? 's' : ''} enregistré{totalPrompts > 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onExporter}
              className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-all duration-200 backdrop-blur-sm hover:scale-105"
              title="Exporter les prompts"
            >
              <Download size={20} />
              <span className="hidden sm:inline">Exporter</span>
            </button>
            <button
              onClick={onImporter}
              className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-all duration-200 backdrop-blur-sm hover:scale-105"
              title="Importer des prompts"
            >
              <Upload size={20} />
              <span className="hidden sm:inline">Importer</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
