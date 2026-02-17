'use client';

import { useEffect, useState } from 'react';
import { ChatView } from '@/components/ChatView';
import { useUIStore } from '@/store/uiStore';

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const { setTheme } = useUIStore();

  useEffect(() => {
    setMounted(true);
    
    // Initialize theme from storage
    try {
      const savedTheme = localStorage.getItem("atlas-theme") as "light" | "dark" | null;
      if (savedTheme) {
        setTheme(savedTheme);
      } else {
        setTheme("dark"); // Default
      }
    } catch (e) {
      console.error("Theme initialization error:", e);
      setTheme("dark");
    }
  }, [setTheme]);

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-border border-t-foreground rounded-full animate-spin" />
          <div className="text-[10px] font-bold tracking-[0.3em] uppercase opacity-50">Initializing...</div>
        </div>
      </div>
    );
  }

  return <ChatView />;
}
