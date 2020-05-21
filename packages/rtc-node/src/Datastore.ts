/**
 * Wraps the lumino datastore to remove lumino specific types and allows you to get tables
 * by name in a type safe way.
 */
import * as LDatastore from "@lumino/datastore";
import { CollaborationClient } from "./client";
import { signalToObservable } from "./util";
import { Observable } from "rxjs";
import { share } from "rxjs/operators";
import { Table } from "./Table";
/**
 * Create a datastore class, then register a number of tables with it.
 *
 * Calling `load` finalizes the table list and connects to the backend.
 *
 * At that point you can get any data from the tables or make updates.
 */
export class Datastore {
  constructor({ url, id }: { url: string; id: number }) {
    this.id = id;
    this.adapter = new CollaborationClient({ url });
  }

  /**
   * Register a schema with the datastore and return a table to get the data from the table.
   */
  register<SCHEMA extends LDatastore.Schema>(schema: SCHEMA): Table<SCHEMA> {
    const { schemas } = this.stateSchemas;
    schemas.push(schema);
    return new Table(this, schema.id);
  }

  /**
   * Calling this finalizes the tables and starts loading the data. After this no more tables can be added.
   * 
   * Returns a promise which resolves when we have finished loading the initial transactions
   */
  connect(): Promise<void> {
    // If we haven't created our datastore yet, do that
    if (isStateSchemas(this.state)) {
      const { schemas } = this.state;
      const datastore = LDatastore.Datastore.create({
        id: this.id,
        schemas,
        adapter: this.adapter,
      });
      // share this observable so we only subscribe once to signal
      const changed = signalToObservable(datastore.changed).pipe(share());
      this.state = { datastore, changed };
    }
    return this.adapter.loaded;
  }


  /**
   * Updates the datastore in a transaction. In the function passed in you should update some tables.
   */
  withTransaction(f: () => void): void {
    const { datastore } = this.stateDatastore;
    datastore.beginTransaction();
    f();
    datastore.endTransaction();
  }

  get stateSchemas(): StateSchemas {
    if (isStateSchemas(this.state)) {
      return this.state;
    }
    throw new Error(
      "We now have loaded the datastore so we cannot change the schema"
    );
  }

  get stateDatastore(): StateDatastore {
    if (isStateSchemas(this.state)) {
      throw new Error(
        "We haven't loaded the datastore yet, so we cannot access it."
      );
    }
    return this.state;
  }

  /**
   * The datastore we are connected to or the list of tables we have to add if we are still adding tbales
   */
  private state: State = { schemas: [] };
  private id: number;
  private adapter: CollaborationClient;
}

type StateSchemas = { schemas: Array<LDatastore.Schema> };

type StateDatastore = {
  datastore: LDatastore.Datastore;
  changed: Observable<LDatastore.Datastore.IChangedArgs>;
};

type State = StateSchemas | StateDatastore;

function isStateSchemas(state: State): state is StateSchemas {
  return "schemas" in state;
}
