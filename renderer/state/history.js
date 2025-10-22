export class History {
  constructor(limit = 50) {
    this.undoStack = [];
    this.redoStack = [];
    this.limit = limit;
  }

  push(state) {
    // clone state before pushing
    this.undoStack.push(state.clone());
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.redoStack = []; // clear redo on new action
  }

  undo() {
    if (this.undoStack.length > 1) {
      const current = this.undoStack.pop();
      this.redoStack.push(current);
      return this.undoStack[this.undoStack.length - 1].clone();
    }
    return null;
  }

  redo() {
    if (this.redoStack.length > 0) {
      const state = this.redoStack.pop();
      this.undoStack.push(state);
      return state.clone();
    }
    return null;
  }
}
