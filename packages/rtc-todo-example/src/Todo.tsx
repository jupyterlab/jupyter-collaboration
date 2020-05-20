// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { Datastore, useDatastoreLoaded, useIds, useRecord } from "rtc-node";
import * as React from "react";
import { UUID } from "@lumino/coreutils";
import { Fields } from "@lumino/datastore";

const datastore = new Datastore({
  url: "ws://localhost:8888",
  id: Math.random(),
});

const table = datastore.register({
  id: "todo",
  fields: {
    description: Fields.Text(),
    show: Fields.Boolean({ value: true }),
  },
});

const Todo: React.FC = () => {
  const loaded = useDatastoreLoaded(datastore);
  if (!loaded) {
    return <div>Loading...</div>;
  }
  return (
    <div>
      <h1>TODO</h1>
      <List />
      <Add />
    </div>
  );
};
export default Todo;

const Add: React.FC = () => {
  const inputEl = React.useRef<HTMLInputElement | null>(null);

  const onSubmit = React.useCallback(
    (e: React.FormEvent<unknown>) => {
      datastore.withTransaction(() => {
        table.update({
          [UUID.uuid4()]: {
            description: {
              index: 0,
              remove: 0,
              text: inputEl.current?.value || "",
            },
          },
        });
      });
      e.preventDefault();
    },
    [inputEl]
  );

  return (
    <form onSubmit={onSubmit}>
      <label>
        Task:
        <input type="text" ref={inputEl} />
      </label>
      <input type="submit" value="Add" />
    </form>
  );
};

const List: React.FC = () => {
  const ids = useIds(table);
  return (
    <ol>
      {ids.map((id) => (
        <Row key={id} id={id} />
      ))}
    </ol>
  );
};

const Row: React.FC<{ id: string }> = ({ id }) => {
  const { show, description } = useRecord(table, id);
  const onClick = React.useCallback(
    (event: React.MouseEvent<unknown, unknown>) => {
      datastore.withTransaction(() =>
        table.update({
          [id]: { show: false },
        })
      );
      event.preventDefault();
    },
    [id]
  );

  if (!show) {
    return <></>;
  }
  return (
    <li id={id}>
      {description}
      <button onClick={onClick}>Remove</button>
    </li>
  );
};
