/**
 * React hooks and components that build on top of the functions exposed in `./helpers`.
 *
 *
 * It assumes a global datastore for some React sub-tree, set by a node that sets a context.
 * This is implicility passed down to all sub-components, to make it less verbose to get and set data.
 *
 * However, it doesn't put the schemas on a context, because we need to refer to them for typing purpose
 *
 *
 * It also makes these assumptions about React best practices:
 *
 * 1. Only pass in primitive data types to nodes, not rich objects with methods. Makes it easier to debug in the provided debugger.
 * 2. Use hooks to get at state that changes over time to abstract that away.
 * 3. Only pass in minimum information down react tree, so that only edge nodes are re-rendered when data changes occur.
 *
 * Also somewhat inspired by Recoil (https://recoiljs.org/) for best practices and naming.
 */
import { Datastore, Record, Schema, Table } from "@lumino/datastore";
import { useObservable, useObservableState } from "observable-hooks";
import React from "react";
import { Observable } from "rxjs";
import { switchMap } from "rxjs/operators";
import {
  createRecord,
  ids,
  record,
  schemas,
  updateRecord,
  updateRecords,
  withTransaction,
} from "./helpers";

const DatastoreContext = React.createContext<null | Datastore>(null);
/**
 * Sets the global datastore context. Either pass in an existing datastore
 * or args to create a new one.
 *
 * Components that use the other hooks must have this as a root.
 *
 * TODO: In the future use suspense for this once it's not beta.
 */
export const DatastoreRoot: React.FC<{ datastore: Observable<Datastore> }> = ({
  children,
  datastore,
}) => {
  const datastoreState = useObservableState(datastore);
  if (datastoreState === undefined) {
    return <div>Loading...</div>;
  }
  return (
    <DatastoreContext.Provider value={datastoreState}>
      {children}
    </DatastoreContext.Provider>
  );
};

function useDatastore(): Datastore {
  const maybeDatastore = React.useContext(DatastoreContext);
  if (maybeDatastore === null) {
    throw new Error("Datastore not set, use DatastoreRoot as parent");
  }
  return maybeDatastore;
}

function useDatastoreObservable<T>(
  fn: (datastore: Datastore) => Observable<T>
): T {
  return useObservableState<T, true>(
    useObservable(
      (input$) => input$.pipe(switchMap(([datastore]) => fn(datastore))),
      [useDatastore()]
    )
  );
}

export function useSchemas(): Array<Schema> {
  return schemas(useDatastore());
}

export function useIds(schema: Schema): Array<string> {
  return useDatastoreObservable(
    React.useCallback((datastore) => ids(datastore, schema), [schema])
  );
}

export function useWithTransaction(): (callback: () => void) => void {
  const datastore = useDatastore();
  return React.useCallback((callback) => withTransaction(datastore, callback), [
    datastore,
  ]);
}

export function useRecordValue<SCHEMA extends Schema>(
  schema: SCHEMA,
  id: string
): Record<SCHEMA> {
  return useDatastoreObservable(
    React.useCallback((datastore) => record(datastore, schema, id), [
      schema,
      id,
    ])
  );
}

export function useSetRecords<SCHEMA extends Schema>(
  schema: SCHEMA
): (update: Table.Update<SCHEMA>) => void {
  const datastore = useDatastore();
  return React.useCallback(
    (update) => updateRecords(datastore, schema, update),
    [datastore, schema]
  );
}

export function useCreateRecord<SCHEMA extends Schema>(
  schema: SCHEMA
): (update: Record.Update<SCHEMA>, options?: { id: string | null }) => string {
  const datastore = useDatastore();
  return React.useCallback(
    (update, options = { id: null }) =>
      createRecord(datastore, schema, update, options),
    [datastore, schema]
  );
}

export function useSetRecord<SCHEMA extends Schema>(
  schema: SCHEMA,
  id: string
): (update: Record.Update<SCHEMA>) => void {
  const datastore = useDatastore();
  return React.useCallback(
    (update) => updateRecord(datastore, schema, id, update),
    [datastore, schema, id]
  );
}

export function useRecord<SCHEMA extends Schema>(
  schema: SCHEMA,
  id: string
): [Record<Schema>, (update: Record.Update<SCHEMA>) => void] {
  return [useRecordValue(schema, id), useSetRecord(schema, id)];
}
