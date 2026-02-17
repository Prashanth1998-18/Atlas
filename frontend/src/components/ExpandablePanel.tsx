import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useUIStore, ActivePanel } from "../store/uiStore";
import { cn } from "../lib/utils";
import { X } from "lucide-react";

interface ExpandablePanelProps {
  children: React.ReactNode;
}

export const ExpandablePanel = ({ children }: ExpandablePanelProps) => {
  const { activePanel, setActivePanel } = useUIStore();

  return (
    <AnimatePresence mode="wait">
      {activePanel && (
        <motion.aside
          initial={{ x: -300, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -300, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="w-72 h-screen flex flex-col bg-background border-r border-border/50 z-20 overflow-hidden"
        >
          {children}
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

export const PanelHeader = ({ title, icon: Icon, onClose, children }: { 
  title: string; 
  icon?: React.ElementType; 
  onClose?: () => void;
  children?: React.ReactNode;
}) => {
  return (
    <div className="flex items-center justify-between px-4 py-4 border-b border-border/50">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={16} className="text-muted-foreground" />}
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/80">{title}</h2>
      </div>
      <div className="flex items-center gap-1">
        {children}
        {onClose && (
          <button 
            onClick={onClose}
            className="p-1 hover:bg-accent rounded-md transition-colors text-muted-foreground hover:text-foreground"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
};
