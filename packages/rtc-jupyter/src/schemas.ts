/* eslint-disable @typescript-eslint/camelcase */
import { Fields } from "@lumino/datastore";
import { createSchemas } from "rtc-node";
import { ReadonlyJSONObject, ReadonlyJSONValue } from "@lumino/coreutils";

// TODO: Add state machine possibility to tables?
// Questions:
// 1. Should an execute request be linked to a cell? So if I run execute and then someone
// else changed the cell, should this be allowed?
// 2. Do we need some kind of branching model? Where different users each work on their
// own copy?
// 3. Should we try to use timely dataflow for this? Basically we are building a streaming database...
// Need way to efficiently compute aggregates based on deltas.
export const schemas = createSchemas({
  kernelspecs: {
    kernelspec: Fields.Register<null | {
      default: boolean;
      name: string;
      KernelSpecFile: {
        language: string;
        argv: Array<string>;
        display_name: string;
        codemirror_mode: string | null | ReadonlyJSONObject;
        env: null | { [envVar: string]: string };
        help_links: Array<{ text: string; url: string }>;
      };
      resources: {
        "kernel.js": string;
        "kernel.css": string;
        logos: { [widthxheight: string]: string };
      };
    }>({ value: null }),
  },
  status: {
    // Table with only one row
    started: Fields.String(),
    last_activity: Fields.String(),
    // TODO: Remove if we can compute dynamically?
    connections: Fields.Number(),
    kernels: Fields.Number(),
  },
  terminals: {
    name: Fields.String(),
  },
  kernels: {
    // TODO: Add session number?
    // TODO: Add info returned by kernal info request
    // TODO: add kernel info requests
    name: Fields.String(),
    last_activity: Fields.String(),
    connections: Fields.Number(),
    execution_state: Fields.Number(),
    status: Fields.Register<"busy" | "idle" | "starting">({ value: "idle" }),
  },
  sessions: {
    path: Fields.String(),
    name: Fields.String(),
    type: Fields.String(),
    state: Fields.Register<
      | { label: "pending"; kernel: { name: string } }
      | { label: "created"; kernelID: string }
    >({ value: { label: "pending", kernel: { name: "" } } }),
  },
  contents: {
    name: Fields.String(),
    path: Fields.String(),
    type: Fields.Register<null | "directory" | "file" | "notebook">({
      value: null,
    }),
    writeable: Fields.Boolean(),
    created: Fields.String(),
    last_modified: Fields.String(),
    size: Fields.Register<null | number>({
      value: null,
    }),
    mimetype: Fields.Register<null | string>({
      value: null,
    }),
    format: Fields.String(),
    // Whether to fetch the content from the server.
    fetch: Fields.Boolean(),
  },
  text_content: {
    // Should relation be to content or from this one?
    content_id: Fields.String(),
    content: Fields.Text(),
  },
  base64_content: {
    content_id: Fields.String(),
    content: Fields.String(),
  },
  folders: {
    content_id: Fields.String(),
    content: Fields.List<string>(),
  },
  notebooks: {
    content_id: Fields.String(),
    nbformat: Fields.Number(),
    nbformatMinor: Fields.Number(),
    cells: Fields.List<string>(),
    metadata: Fields.Map<ReadonlyJSONValue>(),
  },
  cells: {
    attachments: Fields.Map<ReadonlyJSONObject>(),
    executionCount: Fields.Register<number | null>({ value: null }),
    metadata: Fields.Map<ReadonlyJSONValue>(),
    mimeType: Fields.String(),
    // Points to the most recent execution for this cell, if it is executing or has outputs.
    execution: Fields.Register<string | null>({ value: null }),
    text: Fields.Text(),
    trusted: Fields.Boolean(),
    type: Fields.Register<"code" | "markdown" | "raw">({ value: "code" }),
  },
  executions: {
    // Need to keep copy of code, because need to know what it was, if notebook then changes
    code: Fields.String(),
    kernel: Fields.Register<null | {
      id: string;
      session: number;
    }>({ value: null }),
    /**
     * Clients should create a new requested execution and server should make that in progress
     */
    status: Fields.Register<
      // TODO: Other execute request options like silect, etc.
      | { status: "requested" }
      | { status: "in progress" }
      // TODO: user expressions
      | {
          status: "ok";
          execution_count: number | null;
          result: null | {
            data: ReadonlyJSONObject;
            metadata: ReadonlyJSONObject;
          };
        }
      | { status: "abort" }
      | {
          status: "error";
          ename: string;
          evalue: string;
          traceback: Array<string>;
        }
    >({ value: { status: "ok", execution_count: null, result: null } }),
    displays: Fields.List<DisplayType>(),
  },
  // TODO: Introspection
  // TODO: Completion
  // TODO: History requests
  // TODO: is complete request
  // TODO: Comm info
  // TODO: input
  // TODO: Comms
});
export type DisplayType =
  | { type: "stream"; name: "stdout" | "stderr"; text: string }
  | {
      type: "data";
      data: ReadonlyJSONObject;
      metadata: ReadonlyJSONObject;
      display_id: null | string;
    };
