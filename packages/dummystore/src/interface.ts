// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.


import {
  Datastore, Schema, Record
} from '@lumino/datastore';

import { IIterable, IIterator } from '@lumino/algorithm';
import { IDisposable } from '@lumino/disposable';
import { ISignal } from '@lumino/signaling';

export interface IDatastore extends IDisposable, IIterable<ITable<Schema>> {
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
   *
   * #### Complexity
   * `O(1)`
   */
  readonly changed: ISignal<IDatastore, Datastore.IChangedArgs>;

  /**
   * The unique id of the store.
   *
   * #### Notes
   * The id is unique among all other collaborating peers.
   *
   * #### Complexity
   * `O(1)`
   */
  readonly id: number;

  /**
   * Whether a transaction is currently in progress.
   *
   * #### Complexity
   * `O(1)`
   */
  readonly inTransaction: boolean;

  /**
   * The current version of the datastore.
   *
   * #### Notes
   * This version is automatically increased for each transaction
   * to the store. However, it might not increase linearly (i.e.
   * it might make jumps).
   *
   * #### Complexity
   * `O(1)`
   */
  readonly version: number;

  /**
   * Create an iterator over all the tables of the datastore.
   *
   * @returns An iterator.
   */
  iter(): IIterator<ITable<Schema>>;

  /**
   * Get the table for a particular schema.
   *
   * @param schema - The schema of interest.
   *
   * @returns The table for the specified schema.
   *
   * @throws An exception if no table exists for the given schema.
   *
   * #### Complexity
   * `O(log32 n)`
   */
  get<S extends Schema>(schema: S): ITable<S>;

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
  beginTransaction(): string;

  /**
   * Completes a transaction.
   *
   * #### Notes
   * This completes a transaction previously started with
   * `beginTransaction`. If a change has occurred, the
   * `changed` signal will be emitted.
   */
  endTransaction(): void;

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
  undo(transactionId: string): Promise<void>;

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
  redo(transactionId: string): Promise<void>;

  /**
   * Serialize the state of the datastore to a string.
   *
   * @returns The serialized state.
   */
  toString(): string;
}


export namespace IDatastore {
  export interface IOptions {
     /**
     * The unique id of the datastore.
     */
    id: number;

    /**
     * The table schemas of the datastore.
     */
    schemas: ReadonlyArray<Schema>;
  }
}


/**
 * A datastore object which holds a collection of records.
 */
export interface ITable<S extends Schema> extends IIterable<Record<S>> {
  /**
   * The schema for the table.
   *
   * #### Complexity
   * `O(1)`
   */
  readonly schema: S;

  /**
   * Whether the table is empty.
   *
   * #### Complexity
   * `O(1)`
   */
  readonly isEmpty: boolean;

  /**
   * The size of the table.
   *
   * #### Complexity
   * `O(1)`
   */
  readonly size: number;

  /**
   * Create an iterator over the records in the table.
   *
   * @returns A new iterator over the table records.
   *
   * #### Complexity
   * `O(log32 n)`
   */
  iter(): IIterator<Record<S>>;

  /**
   * Test whether the table has a particular record.
   *
   * @param id - The id of the record of interest.
   *
   * @returns `true` if the table has the record, `false` otherwise.
   *
   * #### Complexity
   * `O(log32 n)`
   */
  has(id: string): boolean;

  /**
   * Get the record for a particular id in the table.
   *
   * @param id - The id of the record of interest.
   *
   * @returns The record for the specified id, or `undefined` if no
   *   such record exists.
   *
   * #### Complexity
   * `O(log32 n)`
   */
  get(id: string): Record<S> | undefined;

  /**
   * Update one or more records in the table.
   *
   * @param data - The data for updating the records.
   *
   * #### Notes
   * If a specified record does not exist, it will be created.
   *
   * This method may only be called during a datastore transaction.
   */
  update(data: ITable.Update<S>): void;
}


/**
 * The namespace for the `Table` class statics.
 */
export namespace ITable {
  /**
   * A type alias for the table update type.
   */
  export type Update<S extends Schema> = {
    readonly [recordId: string]: Record.Update<S>;
  };

  /**
   * A type alias for the table change type.
   */
  export type Change<S extends Schema> = {
    readonly [recordId: string]: Record.Change<S>;
  };

  /**
   * A type alias for the table patch type.
   */
  export type Patch<S extends Schema> = {
    readonly [recordId: string]: Record.Patch<S>;
  };
}
