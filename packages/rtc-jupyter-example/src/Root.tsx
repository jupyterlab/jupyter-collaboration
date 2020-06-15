// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import * as React from "react";
import Debugger from "rtc-debugger";
import { schemas } from "rtc-jupyter";
import {
  connect,
  DatastoreRoot,
  useRecordValue,
  useGetOrCreateRecord,
} from "rtc-node";

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
      onSelect(inputEl.current?.value || "");
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
  const contentID = useGetOrCreateRecord(
    schemas.contents,
    (record) => record.path === path,
    { path, fetch: true }
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
    { path, name: path, type: "notebook" }
  );
  const { state } = useRecordValue(schemas.sessions, sessionID);
  return (
    <dl>
      <dd>Kernel</dd>
      <dt>
        {state.label === "pending" ? "Pending..." : <Kernel id={state.label} />}
      </dt>
    </dl>
  );
};

const Kernel: React.FC<{ id: string }> = ({ id }) => {
  const { status, name } = useRecordValue(schemas.kernels, id);
  return (
    <dt>
      <dd>Name</dd>
      <dt>{name}</dt>
      <dd>Status</dd>
      <dt>{status}</dt>
    </dt>
  );
};

const NotebookContent: React.FC<{ contentID: string }> = ({ contentID }) => {
  const notebookID = useGetOrCreateRecord(
    schemas.notebooks,
    (notebook) => notebook.content_id === contentID,
    // eslint-disable-next-line @typescript-eslint/camelcase
    { content_id: contentID }
  );
  const notebook = useRecordValue(schemas.notebooks, notebookID);
  return (
    <dl>
      <dd>Cells</dd>
      <dt>{notebook.cells.length}</dt>
    </dl>
  );
};
