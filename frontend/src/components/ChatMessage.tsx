import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Loader2, X, ChevronDown, ChevronRight, FileText, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../lib/utils";

interface Step {
  id: string;
  description: string;
  status: "running" | "completed" | "error";
  startTime: number;
  endTime?: number;
}

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  sources?: Array<{ doc: string; page?: number }>;
  steps?: Step[];
  isStreaming?: boolean;
}

const StepsDropdown = ({ steps, isStreaming }: { steps: Step[]; isStreaming: boolean }) => {
  const [isExpanded, setIsExpanded] = React.useState(isStreaming);

  React.useEffect(() => {
    if (isStreaming) setIsExpanded(true);
  }, [isStreaming]);

  if (!steps || steps.length === 0) return null;

  const completedCount = steps.filter((s) => s.status === "completed").length;
  const isWorking = steps.some((s) => s.status === "running");

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors bg-accent/30 px-2 py-1 rounded"
      >
        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{isWorking ? "Processing..." : `${completedCount} Steps Taken`}</span>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-2 ml-2 border-l border-primary/20 pl-4 space-y-2 overflow-hidden"
          >
            {steps.map((step) => (
              <div key={step.id} className="flex items-center gap-3 text-[11px]">
                {step.status === "running" ? (
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                ) : step.status === "completed" ? (
                  <Check className="w-3 h-3 text-green-500" />
                ) : (
                  <X className="w-3 h-3 text-red-500" />
                )}
                <span className="text-muted-foreground/80 font-medium">{step.description}</span>
                {step.endTime && step.startTime && (
                  <span className="text-[9px] font-mono opacity-30 ml-auto">
                    {((step.endTime - step.startTime) / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const ChatMessage = ({ role, content, sources, steps, isStreaming }: ChatMessageProps) => {
  const isUser = role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex w-full mb-8",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div className={cn(
        "max-w-[85%] sm:max-w-[75%]",
        isUser ? "flex flex-col items-end" : "flex flex-col items-start"
      )}>
        {/* Sources Pills */}
        {!isUser && sources && sources.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {sources.map((source, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-secondary border border-border/50 rounded-lg text-[10px] font-medium text-muted-foreground">
                <FileText size={12} className="text-muted-foreground" />
                <span className="truncate max-w-[120px]">{source.doc}</span>
              </div>
            ))}
          </div>
        )}

        <div className={cn(
          "px-5 py-4 rounded-[2rem]",
          isUser 
            ? "bg-accent text-foreground rounded-tr-none" 
            : "bg-secondary/50 rounded-tl-none"
        )}>
          {/* Steps inside assistant message */}
          {!isUser && steps && steps.length > 0 && (
            <StepsDropdown steps={steps} isStreaming={isStreaming || false} />
          )}

          <div className={cn(
            "text-[14px] leading-relaxed",
            isUser ? "font-medium" : ""
          )}>
            {isUser ? (
              <p className="whitespace-pre-wrap">{content}</p>
            ) : (
              <ReactMarkdown 
                remarkPlugins={[remarkGfm]}
                components={{
                  // Headings
                  h1: ({ children }) => (
                    <h1 className="text-xl font-bold mb-3 mt-4 first:mt-0 text-foreground">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-lg font-bold mb-2 mt-4 first:mt-0 text-foreground">{children}</h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-base font-semibold mb-2 mt-3 first:mt-0 text-foreground">{children}</h3>
                  ),
                  h4: ({ children }) => (
                    <h4 className="text-sm font-semibold mb-2 mt-3 first:mt-0 text-foreground">{children}</h4>
                  ),
                  
                  // Paragraphs
                  p: ({ children }) => (
                    <p className="mb-3 last:mb-0 text-foreground/90 leading-relaxed">{children}</p>
                  ),
                  
                  // Lists
                  ul: ({ children }) => (
                    <ul className="mb-3 pl-4 space-y-1.5 list-disc marker:text-muted-foreground/50">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="mb-3 pl-4 space-y-1.5 list-decimal marker:text-muted-foreground/50">{children}</ol>
                  ),
                  li: ({ children }) => (
                    <li className="text-foreground/90 leading-relaxed">{children}</li>
                  ),
                  
                  // Code
                  code: ({ className, children, ...props }) => {
                    const match = /language-(\w+)/.exec(className || '');
                    const isBlock = match || (typeof children === 'string' && children.includes('\n'));
                    
                    if (isBlock) {
                      return (
                        <code 
                          className={cn(
                            "block p-4 bg-accent/40 rounded-xl overflow-x-auto text-[12px] font-mono my-3 border border-border/30 text-foreground",
                            className
                          )} 
                          {...props}
                        >
                          {children}
                        </code>
                      );
                    }
                    
                    return (
                      <code 
                        className="px-1.5 py-0.5 bg-accent rounded text-foreground text-[13px] font-mono" 
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                  pre: ({ children }) => (
                    <pre className="mb-3 overflow-hidden rounded-xl">{children}</pre>
                  ),
                  
                  // Blockquotes
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-primary/30 pl-4 py-1 my-3 italic text-foreground/70 bg-accent/10 rounded-r-lg">
                      {children}
                    </blockquote>
                  ),
                  
                  // Links
                  a: ({ href, children }) => (
                    <a 
                      href={href} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-foreground underline hover:opacity-70 inline-flex items-center gap-1"
                    >
                      {children}
                      <ExternalLink size={12} className="opacity-50" />
                    </a>
                  ),
                  
                  // Strong/Bold
                  strong: ({ children }) => (
                    <strong className="font-bold text-foreground">{children}</strong>
                  ),
                  
                  // Emphasis/Italic
                  em: ({ children }) => (
                    <em className="italic">{children}</em>
                  ),
                  
                  // Strikethrough
                  del: ({ children }) => (
                    <del className="line-through opacity-60">{children}</del>
                  ),
                  
                  // Horizontal rule
                  hr: () => (
                    <hr className="my-4 border-border/50" />
                  ),
                  
                  // Tables
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-3 rounded-lg border border-border/50">
                      <table className="min-w-full text-[13px]">{children}</table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead className="bg-accent/30 border-b border-border/50">{children}</thead>
                  ),
                  tbody: ({ children }) => (
                    <tbody className="divide-y divide-border/30">{children}</tbody>
                  ),
                  tr: ({ children }) => (
                    <tr className="hover:bg-accent/10 transition-colors">{children}</tr>
                  ),
                  th: ({ children }) => (
                    <th className="px-3 py-2 text-left font-semibold text-foreground">{children}</th>
                  ),
                  td: ({ children }) => (
                    <td className="px-3 py-2 text-foreground/80">{children}</td>
                  ),
                  
                  // Task lists (GFM)
                  input: ({ checked }) => (
                    <input 
                      type="checkbox" 
                      checked={checked} 
                      readOnly 
                      className="mr-2 accent-primary"
                    />
                  ),
                }}
              >
                {content}
              </ReactMarkdown>
            )}
            {isStreaming && !isUser && !content && (
              <div className="flex items-center gap-1.5 py-2">
                <div className="flex gap-1">
                  <motion.div
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.4, delay: 0 }}
                    className="w-2 h-2 rounded-full bg-muted-foreground"
                  />
                  <motion.div
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.4, delay: 0.2 }}
                    className="w-2 h-2 rounded-full bg-muted-foreground"
                  />
                  <motion.div
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.4, delay: 0.4 }}
                    className="w-2 h-2 rounded-full bg-muted-foreground"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
