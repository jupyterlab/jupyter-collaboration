// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import * as React from "react";
import { Fields } from "@lumino/datastore";
import Debugger from "@jupyter-rtc/debugger";
import {
  connect,
  DatastoreRoot,
  useCreateRecord,
  useIds,
  useRecord,
  createSchemas,
} from "@jupyter-rtc/node";

const schemas = createSchemas({
  todo: {
    description: Fields.String(),
    show: Fields.Boolean({ value: true }),
  },
});

const datastore = connect({
  schemas: Object.values(schemas),
  id: Math.random(),
  url: "ws://localhost:8888",
});

const Todo: React.FC = () => {
  return (
    <DatastoreRoot datastore={datastore}>
      <div>
        <h1>TODO</h1>
        <List />
        <Add />
        <hr />
        <Debugger />
      </div>
    </DatastoreRoot>
  );
};
export default Todo;

const Add: React.FC = () => {
  const inputEl = React.useRef<HTMLInputElement | null>(null);
  const createTodo = useCreateRecord(schemas.todo);
  const onSubmit = React.useCallback(
    (e: React.FormEvent<unknown>) => {
      createTodo({
        description: inputEl.current!.value || "",
      });
      e.preventDefault();
    },
    [createTodo, inputEl]
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
  const ids = useIds(schemas.todo);
  return (
    <ol>
      {ids.map((id) => (
        <Row key={id} id={id} />
      ))}
    </ol>
  );
};

const Row: React.FC<{ id: string }> = ({ id }) => {
  const [{ show, description }, setRecord] = useRecord(schemas.todo, id);
  const onClick = React.useCallback(
    (event: React.MouseEvent<unknown, unknown>) => {
      setRecord({ show: false });
      event.preventDefault();
    },
    [setRecord]
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
