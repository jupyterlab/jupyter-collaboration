import { Datastore } from "./Datastore";
import React from "react";
import { Table } from "./Table";
import { useObservableState } from "observable-hooks";
import { Schema, Record } from "@lumino/datastore";

/**
 * Hook to get whether the datastore is currently loaded.
 *
 * You must call this *after* all the tables have been registered, because calling it
 * implicitly connects to the backend.
 */
export function useDatastoreLoaded(datastore: Datastore): boolean {
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    datastore.connect().then(() => setLoaded(true));
  }, [datastore]);
  return loaded;
}

export function useIds(table: Table<Schema>): Array<string> {
  return useObservableState<string[], true>(table.ids);
}

export function useRecord<SCHEMA extends Schema>(
  table: Table<SCHEMA>,
  id: string
): Record<SCHEMA> {
  return useObservableState<Record<SCHEMA>, true>(table.get(id));
}
