import { useEffect, useState, ReactNode } from "react";
import { File, Folder, ChevronRight, Hash, Terminal } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useDocumentStore } from "../store/documentStore";
import { useUIStore } from "../store/uiStore";
import { listWorkspaceDirectory } from "../lib/workspaceFs";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const PREVIEW_EXTENSIONS = ['.pdf', '.docx', '.md', '.markdown', '.txt'];
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.atlas', '__pycache__', '.venv', 'target', 'dist', 'build']);

export default function FileTree(): ReactNode {
  const { currentWorkspace } = useWorkspaceStore();
  const { setLoading, setContent, setError: setDocError } = useDocumentStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDocumentPreview(filePath: string, fileName: string): Promise<void> {
    if (!currentWorkspace || !isTauri) return;

    const extIdx = fileName.lastIndexOf('.');
    const ext = extIdx !== -1 ? fileName.toLowerCase().slice(extIdx) : '';
    
    if (!PREVIEW_EXTENSIONS.includes(ext)) {
      setDocError(`UNSUPPORTED_FORMAT: ${ext.toUpperCase()}`);
      return;
    }

    try {
      setLoading(filePath, fileName);
      useUIStore.getState().setDocViewerOpen(true);
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_preview_path", { path: filePath });
      const result = await invoke<{
        content: string;
        file_type: string;
        filename: string;
        can_preview: boolean;
      }>("get_preview_content");
      setContent(result.content, result.file_type);
    } catch (err: unknown) {
      console.error("Failed to load document preview:", err);
      setDocError(`IO_EXCEPTION: ${String(err)}`);
    }
  }

  useEffect(() => {
    const loadFiles = async () => {
      if (!currentWorkspace || !isTauri) {
        setNodes([]);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        const rootPath = currentWorkspace.path;
        const workspaceId = currentWorkspace.id;

        async function buildTree(dirPath: string, depth: number = 0): Promise<FileNode[]> {
          if (depth > 5) return [];
          const entries = await listWorkspaceDirectory(workspaceId, dirPath);
          const nodes: FileNode[] = [];
          for (const entry of entries) {
            if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
            const fullPath = entry.path;
            if (entry.is_directory) {
              const children = await buildTree(fullPath, depth + 1);
              nodes.push({ name: entry.name, path: fullPath, type: "folder", children });
            } else if (entry.is_file) {
              nodes.push({ name: entry.name, path: fullPath, type: "file" });
            }
          }
          return nodes.sort((a, b) => {
            if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        }

        const treeNodes = await buildTree(rootPath);
        setNodes(treeNodes);
        const initialExpanded = new Set<string>();
        treeNodes.filter((n) => n.type === "folder").forEach((n) => initialExpanded.add(n.path));
        setExpanded(initialExpanded);
      } catch (err: unknown) {
        console.error("Failed to load file tree:", err);
        setError("ACCESS_DENIED: ROOT_DIR_UNREADABLE");
      } finally {
        setIsLoading(false);
      }
    };
    loadFiles();
  }, [currentWorkspace?.path]);

  function toggleExpand(path: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function renderNode(node: FileNode, depth: number = 0): ReactNode {
    const isExpanded = expanded.has(node.path);
    const isSelected = selected === node.path;
    const isFolder = node.type === "folder";

    return (
      <div key={node.path} className="select-none">
        <div
          className={`flex items-center gap-2 px-4 py-1 cursor-pointer transition-all border-l-2 ${
            isSelected 
              ? "bg-primary/10 border-primary text-primary" 
              : "border-transparent hover:bg-white/[0.03] text-muted-foreground hover:text-foreground"
          }`}
          style={{ paddingLeft: `${depth * 12 + 16}px` }}
          onClick={() => {
            if (isFolder) toggleExpand(node.path);
            else {
              setSelected(node.path);
              loadDocumentPreview(node.path, node.name);
            }
          }}
        >
          <div className="w-3.5 flex items-center justify-center">
            {isFolder && (
              <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-90 text-primary' : 'opacity-30'}`} />
            )}
          </div>
          
          <div className="flex-shrink-0">
            {isFolder ? (
              <Folder className={`w-3.5 h-3.5 ${isSelected ? "text-primary" : "opacity-40"} ${isExpanded ? 'fill-current opacity-20' : ''}`} />
            ) : (
              <File className={`w-3.5 h-3.5 ${isSelected ? "text-primary" : "opacity-40"}`} />
            )}
          </div>
          
          <span className={`text-[11px] truncate font-bold tracking-tight uppercase ${isSelected ? "" : "opacity-80"}`} title={node.name}>
            {node.name}
          </span>
        </div>
        {isFolder && isExpanded && node.children && node.children.length > 0 && (
          <div className="">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  if (!currentWorkspace) return null;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      {isLoading && (
        <div className="flex flex-col items-start px-6 py-4 gap-2 text-primary/40">
          <div className="flex gap-1">
            <div className="w-1 h-3 bg-primary/40 animate-[bounce_1s_infinite_0ms]" />
            <div className="w-1 h-3 bg-primary/40 animate-[bounce_1s_infinite_200ms]" />
          </div>
          <span className="text-[8px] font-bold uppercase tracking-widest">Scanning_System...</span>
        </div>
      )}
      {error && (
        <div className="px-4 py-2 mx-4 my-2 border border-destructive/30 bg-destructive/5 text-destructive text-[9px] font-bold leading-relaxed uppercase tracking-widest">
          {error}
        </div>
      )}
      <div className="py-1">
        {nodes.map((node) => renderNode(node))}
      </div>
    </div>
  );
}
