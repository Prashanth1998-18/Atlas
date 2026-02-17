import React, { useState, useEffect } from "react";
import { X, Key, Check, AlertCircle, Moon, Sun, Monitor, Shield, Zap, Palette } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useUIStore } from "../store/uiStore";
import { cn } from "../lib/utils";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Provider = "openai" | "anthropic";
type Theme = "light" | "dark" | "system";
type SaveStatus = "idle" | "success" | "error";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const SettingsModal = ({ isOpen, onClose }: SettingsModalProps) => {
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<Provider>("openai");
  const { theme, setTheme, toggleTheme } = useUIStore();
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    if (isOpen && isTauri) loadSettings();
  }, [isOpen]);

  async function loadSettings() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const settings = await invoke<{ api_key?: string; provider?: string }>("get_settings");
      if (settings.api_key) setApiKey("sk-" + "•".repeat(40));
      if (settings.provider) setProvider(settings.provider as Provider);
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  }

  async function handleSave() {
    if (!apiKey || apiKey.includes("•")) {
      setStatus("error");
      setStatusMessage("Please enter a valid API key");
      return;
    }

    setIsSaving(true);
    setStatus("idle");

    try {
      if (isTauri) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_settings", {
          settings: { api_key: apiKey, provider: provider },
        });
      }
      setStatus("success");
      setStatusMessage("Settings saved successfully.");
      setTimeout(onClose, 1500);
    } catch (e) {
      setStatus("error");
      setStatusMessage(`Failed to save: ${e}`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        onClick={onClose}
            className="absolute inset-0 bg-background/80 backdrop-blur-md"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-xl bg-card border border-border shadow-2xl rounded-[2rem] overflow-hidden"
          >
        {/* Header */}
            <div className="flex items-center justify-between px-8 py-6 border-b border-border/50 bg-accent/10">
          <div className="flex items-center gap-3">
                <div className="p-2.5 bg-secondary rounded-2xl text-foreground">
                  <Palette size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight">App Settings</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Configuration_Protocol_v1.0</p>
            </div>
          </div>
          <button
            onClick={onClose}
                className="p-2 hover:bg-accent rounded-xl transition-colors text-muted-foreground hover:text-foreground"
          >
                <X size={20} />
          </button>
        </div>

        {/* Content */}
            <div className="p-8 space-y-8">
              {/* Appearance Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  <Monitor size={14} />
                  <span>Appearance</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(["light", "dark"] as const).map((t) => (
              <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className={cn(
                        "flex items-center justify-center gap-2 py-3 px-4 rounded-2xl border transition-all text-xs font-semibold uppercase tracking-wider",
                        theme === t 
                          ? "bg-foreground text-background border-foreground" 
                          : "bg-secondary border-transparent hover:border-border text-muted-foreground"
                      )}
              >
                      {t === "light" && <Sun size={14} />}
                      {t === "dark" && <Moon size={14} />}
                      <span>{t}</span>
              </button>
                  ))}
            </div>
          </div>

              {/* AI Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  <Shield size={14} />
                  <span>Intelligence Configuration</span>
                </div>
                
                <div className="space-y-6">
          <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 ml-1">Provider</label>
                    <div className="flex gap-2 p-1 bg-accent/20 rounded-2xl border border-border/50">
                      {(["openai", "anthropic"] as const).map((p) => (
              <button
                          key={p}
                          onClick={() => setProvider(p)}
                          className={cn(
                            "flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all",
                            provider === p 
                              ? "bg-background text-foreground shadow-sm" 
                              : "text-muted-foreground hover:text-foreground"
                          )}
              >
                          {p === "openai" ? "OpenAI" : "Anthropic"}
              </button>
                      ))}
            </div>
          </div>

          <div className="space-y-2">
                    <div className="flex justify-between items-end ml-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">API Key</label>
              <a
                href={provider === "openai" ? "https://platform.openai.com/api-keys" : "https://console.anthropic.com/"}
                target="_blank"
                rel="noopener noreferrer"
                        className="text-[9px] font-bold text-foreground hover:underline uppercase tracking-widest"
                      >
                        Get Key
                      </a>
                    </div>
                    <div className="relative group">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/40 group-focus-within:text-foreground transition-colors">
                        <Key size={16} />
                      </div>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={`Enter your ${provider === "openai" ? "OpenAI" : "Anthropic"} key`}
                        className="w-full pl-12 pr-4 py-4 bg-secondary border border-border/50 rounded-2xl focus:outline-none focus:border-border font-mono text-sm transition-all"
                      />
                    </div>
                  </div>
                </div>
          </div>

          {/* Status Message */}
              <AnimatePresence>
          {status !== "idle" && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className={cn(
                      "flex items-center gap-3 p-4 rounded-2xl text-xs font-bold uppercase tracking-widest",
                      status === "success" ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                    )}
            >
                    {status === "success" ? <Check size={16} /> : <AlertCircle size={16} />}
                    <span>{statusMessage}</span>
                  </motion.div>
          )}
              </AnimatePresence>

              {/* Footer Actions */}
              <div className="pt-4">
          <button
            onClick={handleSave}
            disabled={isSaving}
                  className="w-full py-5 bg-foreground text-background rounded-[1.5rem] font-bold text-sm uppercase tracking-[0.2em] hover:opacity-90 active:scale-[0.99] disabled:opacity-50 transition-all"
          >
                  {isSaving ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 size={18} className="animate-spin" />
                      <span>Saving_Protocol...</span>
                    </div>
                  ) : (
                    "Execute_Save_Sequence"
                  )}
          </button>
        </div>
      </div>
          </motion.div>
    </div>
      )}
    </AnimatePresence>
  );
};

const Loader2 = ({ size, className }: { size: number; className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M12 2v4" />
    <path d="M12 18v4" />
    <path d="M4.93 4.93l2.83 2.83" />
    <path d="M16.24 16.24l2.83 2.83" />
    <path d="M2 12h4" />
    <path d="M18 12h4" />
    <path d="M4.93 19.07l2.83-2.83" />
    <path d="M16.24 7.76l2.83-2.83" />
  </svg>
);
