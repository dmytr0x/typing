// Each caller observes its own failure; the tail always settles so recovery can run.
export class Coordinator {
  constructor() { this.tail = Promise.resolve(); this.pending = new Map(); this.count = 0; }
  run(operation, key = null) {
    if (key && this.pending.has(key)) {
      const item = this.pending.get(key);
      item.operation = operation;
      return item.promise;
    }
    const item = { operation };
    this.count++;
    item.promise = this.tail.then(async () => {
      if (key) this.pending.delete(key);
      try { return await item.operation(); }
      finally { this.count--; }
    });
    if (key) this.pending.set(key, item);
    this.tail = item.promise.catch(() => {});
    return item.promise;
  }
}
