import React, { useState, useRef, useEffect } from "react";
import { ArrowUp, AtSign, FileText, Hash, X, Paperclip } from "lucide-react";
import { cn } from "../lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useChatStore } from "../store/chatStore";
import { useDocumentStore } from "../store/documentStore";

interface ChatInputProps {
  onSend: (message: string, pinnedDocs: string[]) => void;
  isLoading: boolean;
  workspaceDocs: Array<{ path: string; name: string }>;
}

export const ChatInput = ({ onSend, isLoading, workspaceDocs }: ChatInputProps) => {
  const { inputValue, setInputValue, pinnedDocPaths, addPinnedDoc, removePinnedDoc, clearPinnedDocs } = useChatStore();
  const { textSelections, removeSelection, clearSelections } = useDocumentStore();
  const [isMentionOpen, setIsMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow effect when inputValue changes from store
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [inputValue]);

  const handleInputChange = (value: string) => {
    setInputValue(value);
    
    const lastAt = value.lastIndexOf("@");
    if (lastAt === -1 || value.slice(lastAt + 1).includes(" ")) {
      setIsMentionOpen(false);
      return;
    }
    setIsMentionOpen(true);
    setMentionQuery(value.slice(lastAt + 1));
    setMentionStart(lastAt);
  };

  const handleSend = () => {
    if ((!inputValue.trim() && textSelections.length === 0) || isLoading) return;
    
    // Construct focused context from selections
    let finalMessage = inputValue;
    if (textSelections.length > 0) {
      const selectionsText = textSelections.map(s => {
        const sourceLabel = s.lines 
          ? `(lines ${s.lines[0]}-${s.lines[1]})` 
          : s.page 
          ? `(page ${s.page})` 
          : "(selection)";
        return `[Reference: ${s.filename} ${sourceLabel}]\n${s.text}\n[End Reference]`;
      }).join("\n\n");
      
      finalMessage = `${finalMessage}\n\nFocused Context:\n${selectionsText}`;
    }

    onSend(finalMessage, pinnedDocPaths);
    setInputValue("");
    clearPinnedDocs();
    clearSelections();
  };

  const filteredMentionDocs = isMentionOpen
    ? workspaceDocs.filter((doc) => {
        if (pinnedDocPaths.includes(doc.path)) return false;
        if (!mentionQuery) return true;
        return doc.name.toLowerCase().includes(mentionQuery.toLowerCase());
      })
    : [];

  const pinnedDocs = workspaceDocs.filter(d => pinnedDocPaths.includes(d.path));

  return (
    <div className="w-[90%] max-w-3xl mx-auto relative">
      {/* Mentions Menu */}
      <AnimatePresence>
        {isMentionOpen && filteredMentionDocs.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute bottom-full left-0 right-0 mb-4 bg-popover border border-border shadow-2xl rounded-2xl overflow-hidden z-50"
          >
            <div className="p-3 border-b border-border bg-secondary flex items-center gap-2">
              <Hash size={12} className="text-muted-foreground" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Reference File</span>
            </div>
            <div className="max-h-60 overflow-y-auto custom-scrollbar">
              {filteredMentionDocs.map((doc) => (
                <button
                  key={doc.path}
                  onClick={() => {
                    const before = inputValue.slice(0, mentionStart!);
                    const after = inputValue.slice(inputValue.lastIndexOf("@") + 1 + mentionQuery.length);
                    setInputValue(`${before}@${doc.name} ${after}`);
                    addPinnedDoc(doc.path);
                    setIsMentionOpen(false);
                    textareaRef.current?.focus();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent transition-colors text-left border-b border-border/30 last:border-0"
                >
                  <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-background border border-border/50">
                    <FileText size={14} className="text-muted-foreground" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">{doc.name}</span>
                    <span className="text-[10px] text-muted-foreground/60 truncate font-mono italic">{doc.path}</span>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative flex flex-col bg-secondary border border-border/50 rounded-[1.5rem] shadow-xl focus-within:border-border transition-all overflow-hidden">
        {/* Pinned Docs and Selections Bar */}
        <AnimatePresence>
          {(pinnedDocs.length > 0 || textSelections.length > 0) && (
            <motion.div 
              initial={{ height: 0 }}
              animate={{ height: "auto" }}
              exit={{ height: 0 }}
              className="flex flex-wrap gap-2 px-4 py-3 border-b border-border/30 bg-accent/10 overflow-hidden"
            >
              {/* File Mentions (@) */}
              {pinnedDocs.map((doc) => (
                <div key={doc.path} className="flex items-center gap-2 pl-2 pr-1 py-1 bg-background border border-border rounded-lg text-[11px] font-medium animate-reveal">
                  <span className="truncate max-w-[150px]">{doc.name}</span>
                  <button 
                    onClick={() => removePinnedDoc(doc.path)}
                    className="p-0.5 hover:bg-accent rounded transition-colors text-muted-foreground hover:text-foreground"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}

              {/* Text Selections */}
              {textSelections.map((sel) => (
                <div key={sel.id} className="flex items-center gap-2 pl-2 pr-1 py-1 bg-primary/10 border border-primary/20 rounded-lg text-[11px] font-bold text-primary animate-reveal">
                  <Paperclip size={10} className="text-primary/60" />
                  <span className="truncate max-w-[180px]">
                    {sel.filename} {sel.lines ? `(${sel.lines[0]}-${sel.lines[1]})` : sel.page ? `(p${sel.page})` : "(selection)"}
                  </span>
                  <button 
                    onClick={() => removeSelection(sel.id)}
                    className="p-0.5 hover:bg-primary/20 rounded transition-colors"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-end p-2 gap-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputValue}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask anything about your documents... (@ to reference)"
            className="flex-1 bg-transparent border-0 outline-none focus:ring-0 focus:outline-none p-3 text-[14px] leading-relaxed resize-none custom-scrollbar min-h-[44px]"
          />
          <button
            onClick={handleSend}
            disabled={(!inputValue.trim() && textSelections.length === 0) || isLoading}
            className={cn(
              "flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full transition-all",
              (inputValue.trim() || textSelections.length > 0) && !isLoading
                ? "bg-foreground text-background hover:opacity-80 active:scale-[0.95]"
                : "bg-muted text-muted-foreground opacity-50 cursor-not-allowed"
            )}
          >
            <ArrowUp size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
};
