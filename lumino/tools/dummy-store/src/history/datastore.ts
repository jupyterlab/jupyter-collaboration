// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/*-----------------------------------------------------------------------------
| Copyright (c) 2014-2018, PhosphorJS Contributors
|
| Distributed under the terms of the BSD 3-Clause License.
|
| The full license is in the file LICENSE, distributed with this software.
|----------------------------------------------------------------------------*/

import {
  each, IIterator, map, toArray, toObject, iterItems
} from '@lumino/algorithm';

import {
  LinkedList
} from '@lumino/collections';

import {
  UUID
} from '@lumino/coreutils';

import {
  Datastore, Schema, Record, validateSchema
} from '@lumino/datastore';

import {
  IMessageHandler, Message, MessageLoop, ConflatableMessage
} from '@lumino/messaging';

import {
  ISignal, Signal
} from '@lumino/signaling';

import {
  IDatastore, ITable
} from '../interface';

import {
  UndoStack
} from './stack';

import {
  Table
} from './table';


/**
 * An in-memory only store, with stack-based (LIFO) undo/redo history.
 */
export class HistoryStore implements IDatastore, IMessageHandler {
  static create(options: HistoryStore.IOptions): HistoryStore {
    let {schemas, maxHistory} = options;
    // Throws an error for invalid schemas:
    Private.validateSchemas(schemas);

    let context: HistoryStore.Context =  {
      inTransaction: false,
      transactionId: '',
      version: 0,
      storeId: 0,
      change: {},
    };

    let tables = {} as {[key: string]: Table<Schema>};
    if (options.restoreState) {
      // If passed state to restore, pass the intital state to recreate each
      // table
      let state = JSON.parse(options.restoreState);
      each(schemas, s => {
        tables[s.id] = Table.recreate(s, context, state[s.id] || []);
      });
    } else {
      // Otherwise, simply create a new, empty table
      each(schemas, s => {
        tables[s.id] = Table.create(s, context);
      });
    }

    return new HistoryStore(context, tables, maxHistory);
  }


  /**
   * Dispose of the resources held by the datastore.
   */
  dispose(): void {
    // Bail if already disposed.
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    Signal.clearData(this);
  }

  /**
   * Whether the datastore has been disposed.
   */
  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * A signal emitted when changes are made to the store.
   *
   * #### Notes
   * This signal is emitted either at the end of a local mutation,
   * or after a remote mutation has been applied. The storeId can
   * be used to determine its source.
   *
   * The payload represents the set of local changes that were made
   * to bring the store to its current state.
   */
  get changed(): ISignal<IDatastore, Datastore.IChangedArgs> {
    return this._changed;
  }

  /**
   * The unique id of the store.
   *
   * #### Notes
   * The id is unique among all other collaborating peers.
   */
  get id(): number {
    // No collaboration:
    return 0;
  }

  /**
   * Whether a transaction is currently in progress.
   */
  get inTransaction(): boolean {
    return this._context.inTransaction;
  }

  /**
   * The current version of the datastore.
   *
   * #### Notes
   * This version is automatically increased for each transaction
   * to the store. However, it might not increase linearly (i.e.
   * it might make jumps).
   */
  get version(): number {
    return this._context.version;
  }

  /**
   * Create an iterator over all the tables of the datastore.
   *
   * @returns An iterator.
   */
  iter(): IIterator<Table<Schema>> {
    return map(Object.keys(this._tables), key => this._tables[key]);
  }

  /**
   * Get the table for a particular schema.
   *
   * @param schema - The schema of interest.
   *
   * @returns The table for the specified schema.
   *
   * @throws An exception if no table exists for the given schema.
   */
  get<S extends Schema>(schema: S): Table<S> {
    let t = this._tables[schema.id];
    if (t === undefined) {
      throw new Error(`No table found for schema with id: ${schema.id}`);
    }
    return t as Table<S>;
  }

  /**
   * Begin a new transaction in the store.
   *
   * @returns The id of the new transaction
   *
   * @throws An exception if a transaction is already in progress.
   *
   * #### Notes
   * This will allow the state of the store to be mutated
   * thorugh the `update` method on the individual tables.
   *
   * After the updates are completed, `endTransaction` should
   * be called.
   */
  beginTransaction(): string {
    let newVersion = this._context.version + 1;
    let id = UUID.uuid4();
    this._initTransaction(id, newVersion);
    MessageLoop.postMessage(this, new ConflatableMessage('transaction-begun'));
    return id;
  }

  /**
   * Completes a transaction.
   *
   * #### Notes
   * This completes a transaction previously started with
   * `beginTransaction`. If a change has occurred, the
   * `changed` signal will be emitted.
   */
  endTransaction(): void {
    this._finalizeTransaction();
    let {change, transactionId} = this._context;
    // Emit a change signal
    if (!Private.isChangeEmpty(change)) {
      const args: IDatastore.IChangedArgs = {
        storeId: 0,
        transactionId,
        type: 'transaction',
        change,
      };
      this._historyStack.push(args);
      this._changed.emit(args);
    }
  }

  /**
   * Handle a message.
   */
  processMessage(msg: Message): void {
    switch(msg.type) {
      case 'transaction-begun':
        if (this._context.inTransaction) {
          console.warn(
            `Automatically ending transaction (did you forget to end it?): ${
              this._context.transactionId
            }`
          );
          this.endTransaction();
        }
        break;
      case 'queued-transaction':
        this._processQueue();
        break;
      default:
        break;
    }
  }

  /**
   * Undo a patch that was previously applied.
   *
   * @param transactionId - The transaction to undo.
   *
   * @returns A promise which resolves when the action is complete.
   *
   * @throws An exception if `undo` is called during a mutation, or if no
   *   server adapter has been set for the datastore.
   *
   * #### Notes
   * If changes are made, the `changed` signal will be emitted before
   * the promise resolves.
   */
  undo(transactionId: string): Promise<void> {
    const target = this._historyStack.previous;
    if (target === undefined) {
      throw new Error('No actions to undo');
    } else if (target.transactionId !== transactionId) {
      throw new Error('Can only undo the latest action');
    }
    // This disregards the transactionId, and simply pops the undo stack
    const change = this._historyStack.undo();
    this._processUndoRedo(change, 'undo');
    return Promise.resolve();
  }

  /**
   * Redo a patch that was previously undone.
   *
   * @param transactionId - The transaction to redo.
   *
   * @returns A promise which resolves when the action is complete.
   *
   * @throws An exception if `redo` is called during a mutation, or if no
   *   server adapter has been set for the datastore.
   *
   * #### Notes
   * If changes are made, the `changed` signal will be emitted before
   * the promise resolves.
   */
  redo(transactionId: string): Promise<void> {
    const target = this._historyStack.next;
    if (target === undefined) {
      throw new Error('No actions to redo');
    } else if (target.transactionId !== transactionId) {
      throw new Error('Can only redo the previously undone action');
    }
    const change = this._historyStack.redo();
    this._processUndoRedo(change, 'redo');
    return Promise.resolve();
  }

  /**
   * Serialize the state of the datastore to a string.
   *
   * @returns The serialized state.
   */
  toString(): string {
    return JSON.stringify(toObject(
      map(this, (table): [string, Record<Schema>[]] => {
        return [table.schema.id, toArray(table)];
      })
    ));
  }

  /**
   * Create a new datastore.
   *
   * @param id - The unique id of the datastore.
   * @param tables - The tables of the datastore.
   */
  private constructor(
    context: HistoryStore.Context,
    tables: {[key: string]: Table<Schema>},
    maxHistory?: number,
  ) {
    this._context = context;
    this._tables = tables;
    this._historyStack = new UndoStack(maxHistory);
  }

  
  /**
   * Apply an undo/redo to the datastore.
   *
   * #### Notes
   * If changes are made, the `changed` signal will be emitted.
   */
  private _processUndoRedo(change: IDatastore.IChangedArgs, type: HistoryStore.UndoType): void {
    const {transactionId} = change;
    try {
      this._initTransaction(
        transactionId,
        this._context.version,
      );
    } catch (e) {
      // Already in a transaction. Put the transaction in the queue to apply
      // later.
      this._queueUndoRedo(change, type);
      return;
    }
    let resultingChange: Datastore.MutableChange = {};
    try {
      each(iterItems(change.change), ([schemaId, tablePatch]) => {
        let table = this._tables[schemaId];
        if (table === undefined) {
          console.warn(
            `Missing table for schema id '${
              schemaId
            }'`);
          this._finalizeTransaction();
          return;
        }
        if ( type === 'redo') {
          resultingChange[schemaId] = Table.patch(table, tablePatch);
        } else if ( type === 'undo' ) {
          resultingChange[schemaId] = Table.unpatch(table, tablePatch);
        }
      });
    } finally {
      this._finalizeTransaction();
    }
    if (!Private.isChangeEmpty(resultingChange)) {
      this._changed.emit({
        storeId: 0,
        transactionId,
        type,
        change: resultingChange,
      });
    }
  }

  /**
   * Queue a transaction for later application.
   *
   * @param transaction - the transaction to queue.
   */
  private _queueUndoRedo(change: IDatastore.IChangedArgs, type: HistoryStore.UndoType): void {
    this._undoQueue.addLast([change, type]);
    MessageLoop.postMessage(this, new ConflatableMessage('queued-transaction'));
  }

  /**
   * Process all transactions currently queued.
   */
  private _processQueue(): void {
    let queue = this._undoQueue;
    // If the transaction queue is empty, bail.
    if (queue.isEmpty) {
      return;
    }

    // Add a sentinel value to the end of the queue. The queue will
    // only be processed up to the sentinel. Transactions added during
    // this cycle will execute on the next cycle.
    let sentinel = {};
    queue.addLast(sentinel as any);

    // Enter the processing loop.
    while (true) {
      // Remove the first transaction in the queue.
      let [change, type] = queue.removeFirst()!;

      // If the value is the sentinel, exit the loop.
      if (change === sentinel) {
        return;
      }

      // Apply the transaction.
      this._processUndoRedo(change, type);
    }
  }

  /**
   * Reset the context state for a new transaction.
   *
   * @param id - The id of the new transaction.
   * @param newVersion - The version of the datastore after the transaction.
   *
   * @throws An exception if a transaction is already in progress.
   */
  private _initTransaction(id: string, newVersion: number): void {
    let context = this._context as Private.MutableContext;
    if (context.inTransaction) {
      throw new Error(`Already in a transaction: ${this._context.transactionId}`);
    }
    context.inTransaction = true;
    context.change = {};
    context.transactionId = id;
    context.version = newVersion;
  }

  /**
   * Finalize the context state for a transaction in progress.
   *
   * @throws An exception if no transaction is in progress.
   */
  private _finalizeTransaction(): void {
    let context = this._context as Private.MutableContext;
    if (!context.inTransaction) {
      throw new Error('No transaction in progress.');
    }
    context.inTransaction = false;
  }

  private _disposed = false;
  private _tables: {[key: string]: Table<Schema>};
  private _context: HistoryStore.Context;
  private _changed = new Signal<IDatastore, Datastore.IChangedArgs>(this);
  private _historyStack: UndoStack<IDatastore.IChangedArgs>;
  private _undoQueue = new LinkedList<[IDatastore.IChangedArgs, HistoryStore.UndoType]>();
}


export namespace HistoryStore {
  export type Context = Readonly<Private.MutableContext>;

  export interface IOptions {
    /**
     * The table schemas of the datastore.
     */
    schemas: ReadonlyArray<Schema>;

    /**
     * Initialize the state to a previously serialized one.
     */
    restoreState?: string;

    /**
     * The maximum number of history entries to store.
     */
    maxHistory?: number;
  }

  export type UndoType = 'undo' | 'redo';
}


namespace Private {
  /**
   * Validates all schemas, and throws an error if any are invalid.
   */
  export
  function validateSchemas(schemas: ReadonlyArray<Schema>) {
    let errors = [];
    for (let s of schemas) {
      let err = validateSchema(s);
      if (err.length) {
        errors.push(`Schema '${s.id}' validation failed: \n${err.join('\n')}`);
      }
    }
    if (errors.length) {
      throw new Error(errors.join('\n\n'));
    }
  }

  export
  type MutableContext = {
    /**
     * Whether the datastore currently in a transaction.
     */
    inTransaction: boolean;

    /**
     * The id of the current transaction.
     */
    transactionId: string;

    /**
     * The current version of the datastore.
     */
    version: number;

    /**
     * The unique id of the datastore.
     */
    storeId: number;

    /**
     * The current change object of the transaction.
     */
    change: Datastore.MutableChange;
  }

  /**
   * Checks if a change is empty.
   */
  export function isChangeEmpty(change: Datastore.Change): boolean {
    return Object.keys(change).length === 0;
  }
}

