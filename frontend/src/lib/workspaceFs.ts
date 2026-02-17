export interface WorkspaceDirectoryEntry {
  name: string;
  path: string;
  is_directory: boolean;
  is_file: boolean;
}

export async function listWorkspaceDirectory(
  workspaceId: string,
  directoryPath: string
): Promise<WorkspaceDirectoryEntry[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WorkspaceDirectoryEntry[]>("list_workspace_directory", {
    workspaceId,
    directoryPath,
  });
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function readWorkspaceFileBytes(
  workspaceId: string,
  filePath: string
): Promise<Uint8Array> {
  const { invoke } = await import("@tauri-apps/api/core");
  const dataBase64 = await invoke<string>("read_workspace_file_bytes", {
    workspaceId,
    filePath,
  });
  return base64ToUint8Array(dataBase64);
}
