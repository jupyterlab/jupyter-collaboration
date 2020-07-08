/**
 * Helper functions for dealing with the datastore. Provides these assumptions over base datastore packge:
 *
 * 1. Assume we use CollaborationClient to connect to socket.io server
 * 2. Use RXJS observables for values that change over time
 * 3. Use native arrays instead of lumino iterables.
 * 4. Automatically wrap updates in transactions if we are not in one.
 */
import { toArray } from "@lumino/algorithm";
import { UUID } from "@lumino/coreutils";
import { Datastore, Record, Schema, Table, AnyField } from "@lumino/datastore";
import { concat, defer, Observable, of, ReplaySubject } from "rxjs";
import { distinctUntilChanged, filter, map } from "rxjs/operators";
import { CollaborationClient } from "./client";
import { signalToObservable } from "./util";
import { ObservableWithInitial } from "./ObservableWithInitial";

type SchemasObjectType = {
  [name: string]: {
    readonly [name: string]: AnyField;
  };
};

type SchemasListType<SCHEMAS extends SchemasObjectType> = {
  [ID in keyof SCHEMAS]: {
    readonly id: ID;
    readonly fields: SCHEMAS[ID];
  };
};
/**
 * Given a mapping of ids to fields, returns a mapping of those ids to schemas.
 *
 * Useful when creating a number of schemas and exporting them.
 */
export function createSchemas<SCHEMAS extends SchemasObjectType>(
  schemas: SCHEMAS
): Readonly<SchemasListType<SCHEMAS>> {
  const result = {} as SchemasListType<SCHEMAS>;
  for (const id in schemas) {
    result[id] = { id, fields: schemas[id] };
  }
  return result;
}

/**
 * Creates a new datastrore with a number of schemas and connects to the backend at the URL.
 *
 * Returns an observable which resolves once the initial transactions have been recieved and processed, so it is
 * up to date from the server.
 */
export function connect({
  schemas,
  url,
  id,
}: {
  schemas: Array<Schema>;
  url: string;
  id: number;
}): Observable<Datastore> {
  const subject = new ReplaySubject<Datastore>(1);
  const onLoad = (): void => {
    subject.next(datastore);
    subject.complete();
  };
  const adapter = new CollaborationClient({ url, onLoad });
  const datastore = Datastore.create({
    id,
    schemas,
    adapter,
  });
  return subject;
}

/**
 * Returns an array of all schemas registed in the datastore.
 */
export function getSchemas(datastore: Datastore): Array<Schema> {
  return toArray(datastore).map((table) => table.schema);
}

/**
 * Returns an observables of all the ids for the schema in the datastore
 */
export function ids(
  datastore: Datastore,
  schema: Schema
): ObservableWithInitial<Array<string>> {
  const getIds = (): Array<string> => [...getIdsGenerator(datastore, schema)];

  return [
    getIds,
    changes(datastore, schema).pipe(
      map(getIds),
      // Since id lists are monotocially increasing, we just need to compare length for equality
      distinctUntilChanged((x, y) => x.length == y.length)
    ),
  ];
}

/**
 * Returns an observables of all the records for the schema in the datastore
 */
export function records<SCHEMA extends Schema>(
  datastore: Datastore,
  schema: SCHEMA
): ObservableWithInitial<Array<Record<SCHEMA>>> {
  const getRecords = (): Array<Record<SCHEMA>> =>
    toArray(datastore.get(schema));

  return [getRecords, changes(datastore, schema).pipe(map(getRecords))];
}

/**
 * Returns an observable for a give record in a schema in a datastore.
 */
export function record<SCHEMA extends Schema>(
  datastore: Datastore,
  schema: SCHEMA,
  id: string
): ObservableWithInitial<Record<SCHEMA>> {
  const table = datastore.get(schema);
  const getSingle = (): Record<SCHEMA> => {
    const record = table.get(id);
    if (record === undefined) {
      throw new Error("Record is not in table");
    }
    return record;
  };
  // emit initial value then re-get whenever this record has changed
  return [
    getSingle,
    changes(datastore, schema).pipe(
      filter((change) => id in change),
      map(() => getSingle())
    ),
  ];
}

/**
 * Used to group a number of updates together in a transaction. If already in a transaction, will raise an error.

 */
export function withTransaction(
  datastore: Datastore,
  callback: () => void
): void {
  if (datastore.inTransaction) {
    throw new Error("Already in transaction.");
  }
  datastore.beginTransaction();
  callback();
  datastore.endTransaction();
}

/**
 * Updates records, wrapping in a transcation if we aren't in one
 */
export function updateRecords<SCHEMA extends Schema>(
  datastore: Datastore,
  schema: SCHEMA,
  update: Table.Update<SCHEMA>
): void {
  const alreadyInTransction = datastore.inTransaction;

  if (!alreadyInTransction) {
    datastore.beginTransaction();
  }
  datastore.get(schema).update(update);
  if (!alreadyInTransction) {
    datastore.endTransaction();
  }
}

/**
 * Creates a new record with a random ID and returns that ID.
 */
export function createRecord<SCHEMA extends Schema>(
  datastore: Datastore,
  schema: SCHEMA,
  update: Record.Update<SCHEMA>,
  options: { id: string | null } = { id: null }
): string {
  const id = options.id ?? UUID.uuid4();
  updateRecords(datastore, schema, { [id]: update });
  return id;
}

/**
 * Returns the first record that matches the isValid function or
 * creates a row otherwise
 */
export function getOrCreateRecord<SCHEMA extends Schema>(
  datastore: Datastore,
  schema: SCHEMA,
  isValid: (record: Record<SCHEMA>) => boolean,
  newRecord: Record.Update<SCHEMA> | (() => Record.Update<SCHEMA>),
  oldRecordUpdate?: Record.Update<SCHEMA> | (() => Record.Update<SCHEMA>)
): string {
  const results = toArray(datastore.get(schema)).filter(isValid);
  if (results.length == 0) {
    return createRecord(
      datastore,
      schema,
      typeof newRecord === "function" ? newRecord() : newRecord
    );
  }
  const { $id } = results[0];
  if (oldRecordUpdate) {
    updateRecord(
      datastore,
      schema,
      $id,
      typeof oldRecordUpdate === "function"
        ? oldRecordUpdate()
        : oldRecordUpdate
    );
  }
  return $id;
}

/**
 * Updates a particular record with an ID in the datastore
 */
export function updateRecord<SCHEMA extends Schema>(
  datastore: Datastore,
  schema: SCHEMA,
  id: string,
  update: Record.Update<SCHEMA>
): void {
  updateRecords(datastore, schema, { [id]: update });
}

/**
 * Returns an generator of all ids in the table
 */
function* getIdsGenerator(
  datastore: Datastore,
  schema: Schema
): Generator<string> {
  const table = datastore.get(schema);
  const i = table.iter();
  for (let res = i.next(); res; res = i.next()) {
    yield res.$id;
  }
}

/**
 * Returns an observeable of changes for a datastore.
 */
function datastoreChanges(
  datastore: Datastore
): Observable<Datastore.IChangedArgs> {
  return signalToObservable(datastore.changed);
}

function changes<SCHEMA extends Schema>(
  datastore: Datastore,
  schema: SCHEMA
): Observable<Table.Change<SCHEMA>> {
  return datastoreChanges(datastore).pipe(
    map((changedArgs) => changedArgs.change[schema.id]),
    filter((change) => change !== undefined)
  );
}
