// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { createDatastore } from "rtc-node";
import { UseSignal } from "@jupyterlab/apputils";
import { Fields, Datastore } from "@lumino/datastore";
import * as React from "react";
import { toArray } from "@lumino/algorithm";
import { UUID } from "@lumino/coreutils";

type TODOState = {
  datastore: Datastore | undefined;
};

// Unique ID for client
const ID = Math.random();
const URL = "ws://localhost:8888";

const TODOSchema = {
  id: "todo",
  fields: {
    description: Fields.Text(),
    show: Fields.Boolean({ value: true }),
  },
};

export default class TODO extends React.Component<{}, TODOState> {
  readonly state: TODOState = {
    datastore: undefined,
  };

  input = React.createRef<HTMLInputElement>();

  async componentDidMount() {
    const datastore = await createDatastore({
      url: URL,
      id: ID,
      schemas: [TODOSchema],
    });
    this.setState({ datastore });
  }
  render() {
    const { datastore } = this.state;
    if (!datastore) {
      return <div>Loading...</div>;
    }
    const table = datastore.get(TODOSchema);
    return (
      <div>
        <h1>TODO</h1>
        <ol>
          <UseSignal signal={datastore.changed}>
            {() =>
              toArray(table.iter()).map((row) =>
                row.show ? (
                  <li id={row.$id}>
                    {row.description}
                    <button
                      onClick={(event) => {
                        datastore.beginTransaction();
                        table.update({
                          [row.$id]: { show: false },
                        });
                        datastore.endTransaction();
                        event.preventDefault();
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ) : (
                  <></>
                )
              )
            }
          </UseSignal>
        </ol>
        <form
          onSubmit={(e) => {
            datastore.beginTransaction();
            table.update({
              [UUID.uuid4()]: {
                description: {
                  index: 0,
                  remove: 0,
                  text: this.input.current?.value || "",
                },
              },
            });
            datastore.endTransaction();
            e.preventDefault();
          }}
        >
          <label>
            Task:
            <input type="text" ref={this.input} />
          </label>
          <input type="submit" value="Add" />
        </form>
      </div>
    );
  }

  componentWillUnmount() {
    this.state.datastore && this.state.datastore.dispose();
  }
}
