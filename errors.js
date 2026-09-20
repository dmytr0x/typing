export class Conflict extends Error {
  constructor(m) {
    super(m);
    this.conflict = true;
    this.name = "Conflict";
  }
}

export class RecoveryRequired extends Error {
  constructor(m) {
    super(m);
    this.recovery = true;
    this.name = "RecoveryRequired";
  }
}

export class Unchanged extends Error {
  constructor() {
    super("unchanged");
    this.name = "Unchanged";
  }
}
