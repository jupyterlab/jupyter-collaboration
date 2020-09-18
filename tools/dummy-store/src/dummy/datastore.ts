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
  each, IIterator, map, toArray, toObject
} from '@lumino/algorithm';

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
  IDatastore
} from '../interface';

import {
  Table
} from './table';


export class Dummystore implements IDatastore, IMessageHandler {
  static create(options: Dummystore.IOptions): Dummystore {
    let {schemas} = options;
    // Throws an error for invalid schemas:
    Private.validateSchemas(schemas);

    let context =  {
      inTransaction: false,
      transactionId: '',
      version: 0,
      storeId: 0,
      change: {},
      patch: {},
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

    return new Dummystore(context, tables);
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
    return this._context.storeId;
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
    let {change, storeId, transactionId} = this._context;
    // Emit a change signal
    if (!Private.isChangeEmpty(this._context.change)) {
      this._changed.emit({
        storeId,
        transactionId,
        type: 'transaction',
        change,
      });
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
    throw Error('Dummy store does not support undo');
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
    throw Error('Dummy store does not support redo');
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
    context: Datastore.Context,
    tables: {[key: string]: Table<Schema>},
  ) {
    this._context = context;
    this._tables = tables;
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
  private _context: Datastore.Context;
  private _changed = new Signal<IDatastore, Datastore.IChangedArgs>(this);
}


export namespace Dummystore {
  export interface IOptions {
    /**
     * The table schemas of the datastore.
     */
    schemas: ReadonlyArray<Schema>;

    /**
     * Initialize the state to a previously serialized one.
     */
    restoreState?: string;
  }
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

