import { Conflict, RecoveryRequired, Unchanged } from "./errors.js";
import { upgradeState, MIGRATION_ID, canonical } from "./migrate.js";
import { sha256Hex } from "./scoring.js";
import { emptyState, now, validateState, parseImport } from "./validate.js";

function clone(value) {
  return structuredClone(value);
}

export function createMemoryStore(initialState, {migrationEnabled = true} = {}) {
  const migrationSnapshots = new Map();
  let current = null;
  let previous = null;
  let problem = null;
  const archives = [];
  const initialized = true;

  if (initialState === null) {
    problem = "Previously used state is missing. Restore a backup.";
  } else if (initialState === undefined) {
    current = emptyState();
  } else {
    if(initialState.schema_version !== 2 && !migrationEnabled) throw new RecoveryRequired("Course migration is disabled");
    current = upgradeState(clone(initialState));
    if(initialState.schema_version !== 2) {
      const originals={current:clone(initialState)}, source_json=canonical(originals);
      migrationSnapshots.set("pre-courses-schema-1-to-2",{format:"hearth-pre-courses-v1",migration:MIGRATION_ID,source_revision:current.revision,originals,source_json,checksum:sha256Hex(source_json)});
      current.revision++;current.updated_at=now();
    }
  }

  function read() {
    if (problem) throw new RecoveryRequired(problem);
    if (!current) {
      throw new RecoveryRequired("State is missing, corrupt, or uses an unsupported schema");
    }
    return validateState(clone(current));
  }

  function change(revision, operation, archive = false) {
    if (problem) throw new RecoveryRequired(problem);
    const state = read();
    if (state.revision !== revision) {
      try {
        operation(clone(state));
      } catch (error) {
        if (error instanceof Unchanged) return read();
      }
      throw new Conflict("Another tab saved changes. Reload before continuing.");
    }
    const snapshot = clone(state);
    try {
      operation(state);
    } catch (error) {
      if (error instanceof Unchanged) return read();
      throw error;
    }
    state.revision += 1;
    state.updated_at = now();
    const validated = validateState(state);
    if (archive) {
      archives.push(snapshot);
      if (archives.length > 20) archives.shift();
    }
    previous = snapshot;
    current = validated;
    return validateState(clone(current));
  }

  function recover() {
    if (!previous) {
      throw new RecoveryRequired("State is missing, corrupt, or uses an unsupported schema");
    }
    current = upgradeState(clone(previous));
    problem = null;
    return read();
  }

  return {
    get problem() {
      return problem;
    },
    get initialized() {
      return initialized;
    },
    archives: () => archives.map((state,index) => ({id:String(index),at:state.updated_at,profiles:Object.values(state.profiles).map(p=>p.settings.name)})),
    archiveState: id => upgradeState(clone(archives[Number(id)])),
    recoverImport(state) { current=parseImport(JSON.stringify(state));problem=null;return read(); },
    retainImport(raw) {
      parseImport(raw);const checksum=sha256Hex(raw);
      migrationSnapshots.set(`pre-courses-import:${checksum}`,{format:"hearth-pre-courses-import-v1",migration:MIGRATION_ID,checksum,raw});
    },
    migrationSnapshots: () => [...migrationSnapshots].map(([id,s])=>({id,checksum:s.checksum,source_revision:s.source_revision})),
    migrationSnapshot: id => clone(migrationSnapshots.get(id)),
    read,
    change,
    recover,
    close() {},
  };
}
