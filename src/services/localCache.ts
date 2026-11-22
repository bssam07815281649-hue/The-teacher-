import type { BookPage } from '../types';

const DB_NAME = 'smart_tutor_cache_v1';
const DB_VERSION = 1;
const PAGE_STORE = 'book_pages';
const FILE_STORE = 'raw_pdfs';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PAGE_STORE)) {
        db.createObjectStore(PAGE_STORE, { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE, { keyPath: 'bookId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheBookPage(uid: string, bookId: string, page: BookPage): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(PAGE_STORE, 'readwrite');
    tx.objectStore(PAGE_STORE).put({
      cacheKey: `${uid}__${bookId}__${page.pageNumber}`,
      ...page,
    });
  } catch {
    // Cache failure is non-fatal
  }
}

export async function getCachedBookPage(
  uid: string,
  bookId: string,
  pageNumber: number
): Promise<BookPage | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(PAGE_STORE, 'readonly');
      const req = tx.objectStore(PAGE_STORE).get(`${uid}__${bookId}__${pageNumber}`);
      req.onsuccess = () => resolve((req.result as BookPage | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function cacheRawPdfBytes(bookId: string, buffer: ArrayBuffer): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(FILE_STORE, 'readwrite');
    tx.objectStore(FILE_STORE).put({ bookId, buffer });
  } catch {
    // Non-fatal
  }
}

export async function getCachedRawPdfBytes(bookId: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(FILE_STORE, 'readonly');
      const req = tx.objectStore(FILE_STORE).get(bookId);
      req.onsuccess = () => resolve((req.result as { buffer?: ArrayBuffer } | undefined)?.buffer ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function deleteBookFromLocalCache(uid: string, bookId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx1 = db.transaction(FILE_STORE, 'readwrite');
    tx1.objectStore(FILE_STORE).delete(bookId);

    const tx2 = db.transaction(PAGE_STORE, 'readwrite');
    const store = tx2.objectStore(PAGE_STORE);
    const req = store.openCursor();
    const prefix = `${uid}__${bookId}__`;
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        if (String(cursor.key).startsWith(prefix)) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
  } catch {
    // Non-fatal
  }
}
