
export
class UndoStack<T> {
  constructor(maxSize?: number) {
    if (maxSize !== undefined && maxSize < 1) {
      throw new Error('Cannot have negative or zero maximum size');
    }
    this._maxSize = maxSize;
  }

  /**
   * Last active element on stack. The one that will be undone by a call to `undo`.
   */
  get previous(): T | undefined {
    return this._stack[this._current];
  }

  /**
   * First inactive element on stack. The one that will be redone by a call to `redo`.
   */
  get next(): T | undefined {
    return this._stack[this._current + 1];
  }

  push(elem: T): void {
    this._current += 1;
    // Add our new element to the end, and remove any previous redoable ones
    this._stack.splice(
      this._current,
      this._stack.length - this._current,
      elem
    );
    if (this._maxSize !== undefined) {
      // Shift off front if over maxSize
      const overrun = this._stack.length - this._maxSize;
      // Should only ever be 1 or 0, but let's be defensive.
      if (overrun > 0) {
        this._stack.splice(0, overrun);
        this._current - overrun;
      }
    }
  }

  /**
   * Undo and return the element that was undone.
   */
  undo(): T {
    if (this._current < 0) {
      throw new Error('Nothing to undo');
    }
    return this._stack[this._current--];
  }

  /**
   * Redo and return the element that was redone.
   */
  redo(): T {
    if (this._current >= this._stack.length - 1) {
      throw new Error('Nothing to redo');
    }
    return this._stack[++this._current];
  }

  private _current = -1;
  private _stack: T[] = [];
  private _maxSize: number | undefined;
}