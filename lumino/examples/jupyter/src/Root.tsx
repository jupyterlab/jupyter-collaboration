// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import * as React from "react";
import Debugger from "@jupyterlab-rtc/debugger";
import { schemas } from "@jupyterlab-rtc/jupyter";
import {
  connect,
  DatastoreRoot,
  useRecordValue,
  useGetOrCreateRecord,
  useCreateRecord,
} from "@jupyterlab-rtc/node";

const datastore = connect({
  schemas: Object.values(schemas),
  id: Math.random(),
  url: "ws://localhost:8888",
});

const Root: React.FC = () => {
  const [path, setPath] = React.useState<string | null>(null);
  return (
    <DatastoreRoot datastore={datastore}>
      <div>
        <SelectNotebook onSelect={setPath} />
        {path ? <Notebook path={path} /> : "No notebook selected"}
        <hr />
        <Debugger />
      </div>
    </DatastoreRoot>
  );
};
export default Root;

const SelectNotebook: React.FC<{ onSelect: (path: string) => void }> = ({
  onSelect,
}) => {
  const inputEl = React.useRef<HTMLInputElement | null>(null);
  const onSubmit = React.useCallback(
    (e: React.FormEvent<unknown>) => {
      onSelect(inputEl.current!.value || "");
      e.preventDefault();
    },
    [onSelect]
  );
  return (
    <form onSubmit={onSubmit}>
      <label>
        Path:
        <input type="text" ref={inputEl} />
      </label>
      <input type="submit" value="Open Notebook" />
    </form>
  );
};

const Notebook: React.FC<{ path: string }> = ({ path }) => {
  const createNotebookRecord = useCreateRecord(schemas.notebooks);
  const contentID = useGetOrCreateRecord(
    schemas.contents,
    (record) => record.path === path,
    () => ({ path, fetch: true, content: createNotebookRecord({}) })
  );
  return (
    <div>
      <dl>
        <dt>Path</dt>
        <dd>{path}</dd>
        <dt>Session</dt>
        <dd>
          <NotebookSessions contentID={contentID} />
        </dd>
        <dt>Content</dt>
        <dd>
          <NotebookContent contentID={contentID} />
        </dd>
      </dl>
    </div>
  );
};

const NotebookSessions: React.FC<{ contentID: string }> = ({ contentID }) => {
  const { path } = useRecordValue(schemas.contents, contentID);
  const sessionID = useGetOrCreateRecord(
    schemas.sessions,
    (session) => session.path === path,
    // TODO: Get kernel from content
    {
      path,
      name: path,
      type: "notebook",
      state: { label: "pending", kernel: { name: "python" } },
    }
  );
  const { state } = useRecordValue(schemas.sessions, sessionID);
  return (
    <dl>
      <dt>Kernel</dt>
      <dd>
        {state.label === "pending" ? "Pending..." : <Kernel id={state.label} />}
      </dd>
    </dl>
  );
};

const Kernel: React.FC<{ id: string }> = ({ id }) => {
  const { status, name } = useRecordValue(schemas.kernels, id);
  return (
    <dt>
      <dt>Name</dt>
      <dd>{name}</dd>
      <dt>Status</dt>
      <dd>{status}</dd>
    </dt>
  );
};

const NotebookContent: React.FC<{ contentID: string }> = ({ contentID }) => {
  const content = useRecordValue(schemas.contents, contentID);
  const notebook = useRecordValue(schemas.notebooks, content.content);
  return (
    <dl>
      <dt>Cells</dt>
      <dd>
        <ol>
          {notebook.cells.map((id: any) => (
            <li key={id}>
              <Cell id={id} />
            </li>
          ))}
        </ol>
      </dd>
    </dl>
  );
};

const Cell: React.FC<{ id: string }> = ({ id }) => {
  const cell = useRecordValue(schemas.cells, id);
  return (
    <dl>
      <dt>Type</dt>
      <dd>{cell.type}</dd>
      <dt>Text</dt>
      <dd>{cell.text}</dd>
      {cell.execution ? (
        <>
          <dt>Execution</dt>
          <dd>
            <Execution id={cell.execution} />
          </dd>
        </>
      ) : null}
    </dl>
  );
};

const Execution: React.FC<{ id: string }> = ({ id }) => {
  const execution = useRecordValue(schemas.executions, id);
  return (
    <dl>
      <dt>Status</dt>
      <dd>{JSON.stringify(execution.status)}</dd>
      <dt>Displays</dt>
      <dd>
        <ol>
          {execution.displays.map((display: any, i: any) => (
            <li key={i}>{JSON.stringify(display)}</li>
          ))}
        </ol>
      </dd>
    </dl>
  );
};
