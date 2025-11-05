import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gestionnaire de Prompts - Organisez vos prompts efficacement",
  description: "Application web moderne pour stocker, organiser, rechercher et réutiliser vos prompts textuels. Interface intuitive avec recherche avancée, catégories, tags et export/import JSON.",
  keywords: "prompts, IA, gestion, organisation, recherche, productivité",
  authors: [{ name: "Gestionnaire de Prompts" }],
  viewport: "width=device-width, initial-scale=1",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
