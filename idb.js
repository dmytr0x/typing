import { Conflict, RecoveryRequired, Unchanged } from "./errors.js";
import { emptyState, now, validateState, parseImport } from "./validate.js";
import { migrateState } from "./migrate.js";

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

function addArchive(archives, state) {
  archives.add({ at: now(), revision: state.revision, state });
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
          row.continue();
        }
      };
    }
  };
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

  function startup() {
    return new Promise((resolve, reject) => {
      // Keep the read and every resulting write under the same lock as normal
      // saves. Another tab must never save between this snapshot and migration.
      const tx = db.transaction(["kv", "archives"], "readwrite");
      const kv = tx.objectStore("kv");
      const current = kv.get("current");
      const previous = kv.get("previous");
      const initialized = kv.get("initialized");
      let failure;
      tx.oncomplete = resolve;
      tx.onerror = (event) => {
        failure ||= event.target.error;
      };
      tx.onabort = () => reject(
        failure || tx.error || new Error("Storage startup was interrupted. Retry opening the app."),
      );
      initialized.onsuccess = () => {
        try {
          if (current.result) {
            let state, migrated;
            try {
              state = validateState(current.result);
              migrated = migrateState(state);
              if (migrated) {
                state.revision++;
                state.updated_at = now();
                state = validateState(state);
              }
            } catch (error) {
              kv.put(current.result, "damaged");
              problem = "State is missing, corrupt, or uses an unsupported schema";
              return;
            }
            if (migrated) {
              kv.put(current.result, "previous");
              kv.put(state, "current");
              addArchive(tx.objectStore("archives"), current.result);
            }
            return;
          }
          if (initialized.result || previous.result) {
            problem = "Previously used state is missing. Restore a backup.";
            return;
          }
          kv.put(emptyState(), "current");
          kv.put(true, "initialized");
        } catch (error) {
          failure = error;
          try {
            tx.abort();
          } catch {
            /* already aborted */
          }
        }
      };
    });
  }

  try {
    await startup();
  } catch (error) {
    db.close();
    throw error;
  }

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
          if (archive) addArchive(archives, previous);
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
    return recoverImport(parseImport(JSON.stringify(previous)));
  }

  async function recoverImport(state) {
    // Validate and migrate before opening a replacement transaction.
    const validated = parseImport(JSON.stringify(state));
    const current = await getKv("current");
    const tx = db.transaction("kv", "readwrite");
    if (current) tx.objectStore("kv").put(current, "damaged");
    tx.objectStore("kv").put(validated, "current");
    tx.objectStore("kv").put(true, "initialized");
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    problem = null;
    return validated;
  }

  return {
    get problem() {
      return problem;
    },
    read,
    change,
    recover,
    recoverImport,
    async archives() {
      const tx = db.transaction("archives", "readonly");
      const rows = [];
      await new Promise((resolve, reject) => {
        const req = tx.objectStore("archives").openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) { resolve(); return; }
          const row = cursor.value;
          rows.push({ id: String(cursor.key), at: row.at,
            profiles: Object.values(row.state.profiles).map((p) => p.settings.name) });
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
      return rows.reverse();
    },
    async archiveState(id) {
      const tx = db.transaction("archives", "readonly");
      const row = await request(tx.objectStore("archives").get(Number(id)));
      if (!row) throw new Error("Archive not found");
      return parseImport(JSON.stringify(row.state));
    },
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
