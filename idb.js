import { Conflict, RecoveryRequired, Unchanged } from "./errors.js";
import { emptyState, now, validateState, parseImport } from "./validate.js";
import { MIGRATION_ID, canonical, upgradeState } from "./migrate.js";
import { getCourse } from "./course-registry.js";
import { sha256Hex } from "./scoring.js";

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

function transaction(db, stores, mode = "readwrite") {
  try { return db.transaction(stores, mode, {durability: "strict"}); }
  catch (error) { if (error instanceof TypeError) return db.transaction(stores, mode); throw error; }
}
const SNAPSHOT_KEY = "pre-courses-schema-1-to-2";
export async function openIdbStore({migrationEnabled = false, releaseId = "courses-compatibility"} = {}) {
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
    return new Promise((resolve, reject) => {
      const tx = transaction(db, "kv"), kv = tx.objectStore("kv");
      const keys = ["current", "previous", "damaged", "initialized", SNAPSHOT_KEY];
      const reads = keys.map(key => kv.get(key));
      let failure = null;
      reads.at(-1).onsuccess = () => {
        try {
          const [current, previous, damaged, initialized, existing] = reads.map(req => req.result);
          if (current !== undefined) {
            if (current?.schema_version !== 2 && !migrationEnabled) throw new Error("Course migration is disabled in this compatibility release. Export from the prior app or activate a verified release.");
            const state = upgradeState(current);
            if (current.schema_version !== 2) {
              for(const profile of Object.values(state.profiles)) for(const [courseId,progress] of Object.entries(profile.courses)) {
                const attempt=progress.active_session;
                if(attempt) { const course=getCourse(courseId,attempt.curriculum_version);if(attempt.lesson_id && !course.BY_ID[attempt.lesson_id]) throw new Error("Saved exercise definition unavailable; migration is blocked. Export the original household."); }
              }
              const originals = {current};
              if (previous !== undefined) originals.previous = previous;
              if (damaged !== undefined) originals.damaged = damaged;
              const checksum = sha256Hex(canonical(originals));
              const snapshot = { format: "hearth-pre-courses-v1", release: releaseId, migration: MIGRATION_ID, checksum, source_json: canonical(originals), source_revision: current.revision ?? 0, result_revision: state.revision + 1, originals: structuredClone(originals) };
              if (existing && (existing.migration !== MIGRATION_ID || existing.checksum !== checksum || canonical(existing.originals) !== canonical(originals))) throw new Error("Inconsistent pre-course snapshot; no household changes were made");
              if (!existing) kv.add(snapshot, SNAPSHOT_KEY);
              state.revision++; state.updated_at = now();
              kv.put(current, "previous");
              kv.put(state, "current");
            }
          } else if (initialized || previous !== undefined || damaged !== undefined || existing !== undefined) {
            throw new Error("Previously used state is missing. Restore a backup.");
          } else {
            kv.add(emptyState(), "current"); kv.put(true, "initialized");
          }
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => {
        if (typeof BroadcastChannel === "function") { const channel = new BroadcastChannel("hearth-changes"); channel.postMessage({upgrade:true, protocol:2}); channel.close(); }
        resolve();
      };
      tx.onabort = tx.onerror = () => {
        problem = failure?.message || tx.error?.message || "Course migration failed. Original household and backups were retained. Export or retry after checking storage space.";
        resolve();
      };
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
      const tx = transaction(db, ["kv", "archives"]);
      const kv = tx.objectStore("kv");
      const archives = tx.objectStore("archives");
      let result;
      tx.oncomplete = () => resolve(clone(result));
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
                result = state;
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
              result = previous;
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
          result = validated;
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
    const validated = parseImport(JSON.stringify(state));
    await new Promise((resolve, reject) => {
      const tx = transaction(db, "kv"), kv = tx.objectStore("kv");
      const req = kv.get("current");
      req.onsuccess = () => {
        if (req.result !== undefined) {
          kv.put(req.result, "damaged");
          kv.add({original: req.result}, `recovery-source:${crypto.randomUUID()}`);
        }
        kv.put(validated, "current"); kv.put(true, "initialized");
      };
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("Recovery transaction aborted"));
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
    async migrationPreparation() {
      const current=await getKv("current"), candidate=upgradeState(current), unresolved=[];
      const profiles={};
      for(const [id,profile] of Object.entries(candidate.profiles)) {
        profiles[id]={};
        for(const [courseId,progress] of Object.entries(profile.courses)) {
          const a=progress.active_session;
          profiles[id][courseId]={curriculum_version:progress.curriculum_version,lessons:Object.keys(progress.lesson_progress).length,attempts:progress.attempts.length,assessments:progress.assessment_history.length,events:a?.events.length||0,passages:progress.learning.passages.length};
          if(a) try { const course=getCourse(courseId,a.curriculum_version);if(a.lesson_id && !course.BY_ID[a.lesson_id]) throw new Error("Saved lesson definition unavailable"); } catch(error) { unresolved.push({profile:id,course:courseId,attempt:a.id,reason:error.message}); }
        }
      }
      return {migration:MIGRATION_ID,source_checksum:sha256Hex(canonical(current)),source_revision:current.revision,profiles,preserved:true,unresolved_active:unresolved,ready:unresolved.length===0};
    },
    async originalHousehold() { return getKv("current"); },
    async retainImport(raw) {
      const validated = parseImport(raw);
      const original = JSON.parse(raw);
      if ((original.schema_version ?? 1) !== 1) return;
      const checksum = sha256Hex(raw), key = `pre-courses-import:${checksum}`;
      await new Promise((resolve,reject) => {
        const tx=transaction(db,"kv"),kv=tx.objectStore("kv"),req=kv.get(key);
        let failure;
        req.onsuccess=()=>{
          try {
            if(req.result && req.result.raw !== raw) throw new Error("Inconsistent original import snapshot");
            if(!req.result) kv.add({format:"hearth-pre-courses-import-v1",migration:MIGRATION_ID,checksum,raw,source_revision:validated.revision},key);
          } catch(error){failure=error;tx.abort();}
        };
        tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(failure||tx.error||new Error("Original import retention failed"));
      });
    },
    async migrationSnapshots() {
      const tx=db.transaction("kv","readonly"),kv=tx.objectStore("kv");
      const keys=await request(kv.getAllKeys());
      const rows=[];
      for(const id of keys.filter(key=>key === SNAPSHOT_KEY || String(key).startsWith("pre-courses-import:"))) {
        const snapshot=await getKv(id);
        rows.push({id,checksum:snapshot.checksum,source_revision:snapshot.source_revision});
      }
      return rows;
    },
    async migrationSnapshot(id) {
      if(id !== SNAPSHOT_KEY && !String(id).startsWith("pre-courses-import:")) throw new Error("Snapshot not found");
      const snapshot=await getKv(id);
      const source=snapshot?.raw ?? snapshot?.source_json;
      if(typeof source !== "string" || sha256Hex(source) !== snapshot.checksum) throw new Error("Snapshot verification failed");
      if(snapshot.originals && canonical(JSON.parse(source)) !== canonical(snapshot.originals)) throw new Error("Snapshot verification failed");
      return snapshot;
    },
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
