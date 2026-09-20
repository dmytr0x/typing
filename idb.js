import { Conflict, RecoveryRequired, Unchanged } from "./errors.js";
import { emptyState, now, validateState } from "./validate.js";

const DB_NAME = "hearth-typing";
const DB_VERSION = 1;
const ARCHIVE_CAP = 20;

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("archives"))
        db.createObjectStore("archives", { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function clone(value) {
  return structuredClone(value);
}

export async function openIdbStore() {
  let db;
  try {
    db = await openDb();
  } catch (error) {
    throw new RecoveryRequired(
      "This browser would not open local storage. Try a non-private window, or export a backup.",
    );
  }

  let problem = null;

  async function getKv(key) {
    const tx = db.transaction("kv", "readonly");
    return request(tx.objectStore("kv").get(key));
  }

  async function startup() {
    const current = await getKv("current");
    const previous = await getKv("previous");
    const initialized = await getKv("initialized");
    if (current) {
      try {
        validateState(current);
      } catch (error) {
        await putKv("damaged", current);
        problem = "State is missing, corrupt, or uses an unsupported schema";
      }
      return;
    }
    if (initialized || previous) {
      problem = "Previously used state is missing. Restore a backup.";
      return;
    }
    const fresh = emptyState();
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(fresh, "current");
    tx.objectStore("kv").put(true, "initialized");
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function putKv(key, value) {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  await startup();

  async function read() {
    if (problem) throw new RecoveryRequired(problem);
    const current = await getKv("current");
    if (!current) {
      throw new RecoveryRequired("State is missing, corrupt, or uses an unsupported schema");
    }
    try {
      return validateState(clone(current));
    } catch (error) {
      throw new RecoveryRequired("State is missing, corrupt, or uses an unsupported schema");
    }
  }

  async function change(revision, operation, archive = false) {
    if (problem) throw new RecoveryRequired(problem);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["kv", "archives"], "readwrite");
      const kv = tx.objectStore("kv");
      const archives = tx.objectStore("archives");
      const getCurrent = kv.get("current");
      getCurrent.onsuccess = () => {
        try {
          if (!getCurrent.result) {
            throw new RecoveryRequired(
              "State is missing, corrupt, or uses an unsupported schema",
            );
          }
          const state = validateState(clone(getCurrent.result));
          if (state.revision !== revision) {
            try {
              operation(clone(state));
            } catch (error) {
              if (error instanceof Unchanged) {
                resolve(clone(state));
                return;
              }
            }
            throw new Conflict("Another tab saved changes. Reload before continuing.");
          }
          const previous = clone(state);
          try {
            operation(state);
          } catch (error) {
            if (error instanceof Unchanged) {
              resolve(clone(previous));
              return;
            }
            throw error;
          }
          state.revision += 1;
          state.updated_at = now();
          const validated = validateState(state);
          kv.put(previous, "previous");
          kv.put(validated, "current");
          if (archive) {
            archives.add({ at: now(), revision: previous.revision, state: previous });
            const count = archives.count();
            count.onsuccess = () => {
              if (count.result > ARCHIVE_CAP) {
                let remaining = count.result - ARCHIVE_CAP;
                const cursor = archives.openCursor();
                cursor.onsuccess = () => {
                  const row = cursor.result;
                  if (row && remaining > 0) {
                    remaining -= 1;
                    row.delete();
                    cursor.continue();
                  }
                };
              }
            };
          }
          tx.oncomplete = () => resolve(clone(validated));
        } catch (error) {
          try {
            tx.abort();
          } catch {
            /* already aborted */
          }
          reject(error);
        }
      };
      getCurrent.onerror = () => reject(getCurrent.error);
      tx.onerror = () => {
        const err = tx.error;
        if (err && err.name === "QuotaExceededError") {
          reject(
            new Error(
              "Save failed. This browser is out of storage space. Export a backup, then retry.",
            ),
          );
          return;
        }
        reject(err);
      };
      tx.onabort = () => {
        const err = tx.error;
        if (err && err.name === "QuotaExceededError") {
          reject(
            new Error(
              "Save failed. This browser is out of storage space. Export a backup, then retry.",
            ),
          );
          return;
        }
        if (err) reject(err);
      };
    });
  }

  async function recover() {
    const previous = await getKv("previous");
    if (!previous) {
      throw new RecoveryRequired("State is missing, corrupt, or uses an unsupported schema");
    }
    const current = await getKv("current");
    const tx = db.transaction("kv", "readwrite");
    if (current) tx.objectStore("kv").put(current, "damaged");
    tx.objectStore("kv").put(previous, "current");
    tx.objectStore("kv").put(true, "initialized");
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    problem = null;
    return validateState(clone(previous));
  }

  return {
    get problem() {
      return problem;
    },
    read,
    change,
    recover,
    close() {
      db.close();
    },
  };
}

export async function deleteIdbHousehold() {
  const db = await openDb();
  const tx = db.transaction("kv", "readwrite");
  tx.objectStore("kv").delete("current");
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
