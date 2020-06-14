import { Fields } from "@lumino/datastore";
import { createSchemas } from "rtc-node";
import { ReadonlyJSONObject, ReadonlyJSONValue } from "@lumino/coreutils";

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
    connections: Fields.Number(),
    kernels: Fields.Number(),
  },
  terminals: {
    name: Fields.String(),
  },
  kernels: {
    name: Fields.String(),
    last_activity: Fields.String(),
    connections: Fields.Number(),
    execution_state: Fields.Number(),
  },
  sessions: {
    path: Fields.String(),
    name: Fields.String(),
    type: Fields.String(),
    kernel_id: Fields.String(),
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
    format: Fields.Register<null | "text" | "base64" | "notebook">({
      value: null,
    }),
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
    outputs: Fields.List<string>(),
    text: Fields.Text(),
    trusted: Fields.Boolean(),
    type: Fields.Register<"code" | "markdown" | "raw">({ value: "code" }),
  },
  outputs: {
    trusted: Fields.Boolean(),
    type: Fields.String(),
    executionCount: Fields.Register<number | null>({ value: null }),
    data: Fields.Register<ReadonlyJSONObject>({ value: {} }),
    metadata: Fields.Register<ReadonlyJSONObject>({ value: {} }),
    raw: Fields.Register<ReadonlyJSONObject>({ value: {} }),
  },
});
