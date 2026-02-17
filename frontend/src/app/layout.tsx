import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atlas - Document AI Assistant",
  description: "A desktop application for document intelligence",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: 'dark' }}>
      <body className="overflow-hidden h-screen w-screen selection:bg-primary/30">
        {children}
      </body>
    </html>
  );
}
