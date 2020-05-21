import * as LDatastore from "@lumino/datastore";
import { Datastore } from "./Datastore";
import { Observable, of, concat, defer } from "rxjs";
import { map, filter, share, distinctUntilChanged } from "rxjs/operators";
import { Schema } from "@lumino/datastore";

export class Table<SCHEMA extends LDatastore.Schema> {
  constructor(
    private readonly datastore: Datastore,
    private readonly id: SCHEMA["id"]
  ) {}

  // TODO: Add more granular observables for each field and cache this
  get(id: string): Observable<LDatastore.Record<SCHEMA>> {
    const getSingle = (): LDatastore.Record<SCHEMA> => {
      const record = this.state.table.get(id);
      if (record === undefined) {
        throw new Error("Record is not in table");
      }
      return record;
    };

    // emit initial value then re-get whenever this record has changed
    return concat(
      defer(() => of(getSingle())),
      this.state.changes.pipe(
        filter((change) => id in change),
        map(() => getSingle())
      )
    );
  }

  update(data: LDatastore.Table.Update<SCHEMA>): void {
    this.state.table.update(data);
  }

  get ids(): Observable<Array<string>> {
    return this.state.ids;
  }

  private get state(): State<SCHEMA> {
    // if we haven't gotten this table yet, do that and subscribe to signals
    if (this._state === null) {
      const { datastore, changed } = this.datastore.stateDatastore;
      const table = datastore.get({ id: this.id } as SCHEMA);
      const changes = changed.pipe(
        map((changedArgs) => changedArgs.change[this.id]),
        filter((change) => change !== undefined),
        share()
      );
      const ids = concat(
        defer(() => of([...getTableIds(table)])),
        changes.pipe(
          // TODO: possibly refactor as iterative algorithm adding new IDs from each change
          map(() => [...getTableIds(table)]),
          // Since id lists are monotocially increasing, we just need to compare length for equality
          distinctUntilChanged((x, y) => x.length == y.length),
          share()
        )
      );
      this._state = { table, changes, ids };
    }
    return this._state;
  }

  private _state: State<SCHEMA> | null = null;
}

type State<SCHEMA extends LDatastore.Schema> = {
  table: LDatastore.Table<SCHEMA>;
  changes: Observable<LDatastore.Table.Change<SCHEMA>>;
  ids: Observable<Array<string>>;
};

function* getTableIds(table: LDatastore.Table<Schema>): Generator<string> {
  const i = table.iter();
  for (let res = i.next(); res; res = i.next()) {
    yield res.$id;
  }
}
