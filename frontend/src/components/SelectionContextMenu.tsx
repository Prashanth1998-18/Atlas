import React, { useEffect, useState } from "react";
import { PlusCircle } from "lucide-react";

interface SelectionContextMenuProps {
  x: number;
  y: number;
  selection: string;
  onAdd: (selection: string) => void;
  onClose: () => void;
}

export const SelectionContextMenu: React.FC<SelectionContextMenuProps> = ({
  x,
  y,
  selection,
  onAdd,
  onClose,
}) => {
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    // Adjust position if it goes off screen
    const menuWidth = 160;
    const menuHeight = 40;
    const padding = 10;

    let adjustedX = x;
    let adjustedY = y;

    if (x + menuWidth > window.innerWidth) {
      adjustedX = window.innerWidth - menuWidth - padding;
    }
    if (y + menuHeight > window.innerHeight) {
      adjustedY = window.innerHeight - menuHeight - padding;
    }

    setPosition({ x: adjustedX, y: adjustedY });

    const handleClickOutside = () => onClose();
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, [x, y, onClose]);

  return (
    <div
      className="fixed z-[100] bg-popover border border-border shadow-2xl rounded-lg overflow-hidden min-w-[160px] animate-in fade-in zoom-in duration-100"
      style={{ top: position.y, left: position.x }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => {
          onAdd(selection);
          onClose();
        }}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-[11px] font-black text-foreground hover:bg-accent hover:text-accent-foreground transition-colors uppercase tracking-widest"
      >
        <PlusCircle size={14} className="text-primary" />
        Add to Chat
      </button>
    </div>
  );
};
