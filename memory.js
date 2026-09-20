import { Conflict, RecoveryRequired, Unchanged } from "./errors.js";
import { emptyState, now, validateState } from "./validate.js";

function clone(value) {
  return structuredClone(value);
}

export function createMemoryStore(initialState) {
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
    current = validateState(clone(initialState));
  }

  function read() {
    if (problem) throw new RecoveryRequired(problem);
    if (!current) {
      throw new RecoveryRequired("State is missing, corrupt, or uses an unsupported schema");
    }
    return clone(current);
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
    return clone(current);
  }

  function recover() {
    if (!previous) {
      throw new RecoveryRequired("State is missing, corrupt, or uses an unsupported schema");
    }
    current = clone(previous);
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
    archives,
    read,
    change,
    recover,
    close() {},
  };
}
