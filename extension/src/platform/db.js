/**
 * IndexedDB access.
 *
 * Visits are the only high-volume data, so they live here rather than in
 * chrome.storage: a busy year is roughly 100k rows, which IndexedDB handles
 * comfortably and chrome.storage does not. Extension pages and the service
 * worker share one origin, so the dashboard reads this store directly instead of
 * shuttling megabytes through message passing.
 */

const DB_NAME = 'billed';
const DB_VERSION = 1;
const STORE = 'visits';

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('by-start', 'start');
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        dbPromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function run(mode, work) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    try {
      result = work(store, tx);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result && result.value !== undefined ? result.value : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

function requestValue(request) {
  const box = { value: undefined };
  request.onsuccess = () => { box.value = request.result; };
  return box;
}

/** Insert or update one visit. Called on every heartbeat for the open segment. */
export function putVisit(visit) {
  return run('readwrite', (store) => { store.put(visit); });
}

export function putVisits(visits) {
  return run('readwrite', (store) => {
    for (const visit of visits) store.put(visit);
  });
}

export function getVisit(id) {
  return run('readonly', (store) => requestValue(store.get(id)));
}

/** Every visit that overlaps `[from, to)`, ordered by start. */
export function getVisitsBetween(from, to) {
  return run('readonly', (store) => {
    const out = [];
    // A visit can start before the window and still overlap it, so widen the
    // lower bound generously (no single session runs longer than a day).
    const range = IDBKeyRange.bound(from - 86_400_000, to);
    const request = store.index('by-start').openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const visit = cursor.value;
      if (visit.end > from && visit.start < to) out.push(visit);
      cursor.continue();
    };
    return { value: out };
  });
}

export function getAllVisits() {
  return run('readonly', (store) => requestValue(store.getAll()));
}

export function countVisits() {
  return run('readonly', (store) => requestValue(store.count()));
}

/** Oldest and newest instants we hold, used to show real history depth. */
export function getBounds() {
  return run('readonly', (store) => {
    const box = { value: { first: null, last: null } };
    const index = store.index('by-start');
    const firstRequest = index.openCursor(null, 'next');
    firstRequest.onsuccess = () => {
      if (firstRequest.result) box.value.first = firstRequest.result.value.start;
    };
    const lastRequest = index.openCursor(null, 'prev');
    lastRequest.onsuccess = () => {
      if (lastRequest.result) box.value.last = lastRequest.result.value.end;
    };
    return box;
  });
}

export function deleteVisitsBetween(from, to) {
  return run('readwrite', (store) => {
    const request = store.index('by-start').openCursor(IDBKeyRange.bound(from - 86_400_000, to));
    let deleted = 0;
    const box = { value: 0 };
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { box.value = deleted; return; }
      const visit = cursor.value;
      if (visit.end > from && visit.start < to) {
        cursor.delete();
        deleted += 1;
      }
      cursor.continue();
    };
    return box;
  });
}

/** Used by "forget this site", so a user can erase one domain without nuking everything. */
export function deleteVisitsByHostname(hostname) {
  return run('readwrite', (store) => {
    const request = store.openCursor();
    let deleted = 0;
    const box = { value: 0 };
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { box.value = deleted; return; }
      if (cursor.value.hostname === hostname) {
        cursor.delete();
        deleted += 1;
      }
      cursor.continue();
    };
    return box;
  });
}

/** Retention enforcement. */
export function pruneBefore(ts) {
  return run('readwrite', (store) => {
    const request = store.index('by-start').openCursor(IDBKeyRange.upperBound(ts));
    let deleted = 0;
    const box = { value: 0 };
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { box.value = deleted; return; }
      cursor.delete();
      deleted += 1;
      cursor.continue();
    };
    return box;
  });
}

/** Delete one record — used for manual entries and single-line corrections. */
export function deleteVisit(id) {
  return run('readwrite', (store) => { store.delete(id); });
}

export function deleteAllVisits() {
  return run('readwrite', (store) => { store.clear(); });
}
