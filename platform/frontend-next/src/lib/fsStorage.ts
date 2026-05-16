/**
 * fsStorage.ts
 *
 * Helpers para persistir um FileSystemDirectoryHandle no IndexedDB,
 * permitindo que a pasta de saída de experimentos sobreviva a
 * recarregamentos de página.
 *
 * A File System Access API (showDirectoryPicker) requer que o usuário
 * reautorize o acesso após fechar o browser; por isso, ao restaurar o
 * handle, chamamos requestPermission({ mode: "readwrite" }) silenciosamente.
 */

const DB_NAME = "netops-fs-storage";
const STORE_NAME = "handles";
const DIR_KEY = "experimentSaveDir";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(handle, DIR_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB not available (SSR / private browsing) — silently ignore
  }
}

export async function loadDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    return await new Promise<FileSystemDirectoryHandle | null>(
      (resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(DIR_KEY);
        req.onsuccess = () =>
          resolve(
            (req.result as FileSystemDirectoryHandle | undefined) ?? null,
          );
        req.onerror = () => reject(req.error);
      },
    );
  } catch {
    return null;
  }
}

export async function clearDirHandle(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(DIR_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

/**
 * Verifica se a File System Access API está disponível neste browser.
 */
export function fsSupportedInBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as Record<string, unknown>)
      .showDirectoryPicker === "function"
  );
}

/**
 * Solicita (ou restaura) permissão de leitura/escrita para um handle
 * já armazenado.  Retorna true se a permissão foi concedida.
 */
export async function requestPermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  try {
    const perm = await (handle as FileSystemDirectoryHandle & { requestPermission: (o: unknown) => Promise<string> }).requestPermission({
      mode: "readwrite",
    });
    return perm === "granted";
  } catch {
    return false;
  }
}

/**
 * Escreve (ou sobrescreve) um arquivo JSON na pasta informada.
 */
export async function writeJsonToDir(
  dir: FileSystemDirectoryHandle,
  filename: string,
  data: unknown,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await (fileHandle as FileSystemFileHandle & { createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }).createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

/**
 * Lê todos os arquivos `.json` na pasta e tenta parsear como T.
 * Retorna apenas os que foram parseados com sucesso.
 */
export async function readJsonFilesFromDir<T>(
  dir: FileSystemDirectoryHandle,
  validate: (v: unknown) => v is T,
): Promise<T[]> {
  const results: T[] = [];
  for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind !== "file") continue;
    if (!String(name).endsWith(".json")) continue;
    try {
      const file: File = await (handle as FileSystemFileHandle).getFile();
      const text: string = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (validate(parsed)) results.push(parsed);
    } catch {
      // invalid / corrupt file — skip
    }
  }
  return results;
}
