import { AnyField, Fields } from "@phosphor/datastore";
import { ReadonlyJSONObject, ReadonlyJSONValue } from "@phosphor/coreutils";
import { nbformat } from "@jupyterlab/coreutils";

// Q: Do we add "refrefsh xxx" method?
// N: Yes.

// Q: Do we fully normalize into tables?
// A: No, only enough to allow collaboration.
//    So anything that might need to be merged should be its own field.
//    Also, we want to minimize the size of diffs.

// Q: Where should selections go?
// A: ?

// Q: Should output refer to cells or vice versa?

export const TABLES: { [id: string]: { [name: string]: AnyField } } = {
  kernelspecs: {
    // have all as one field instead of many fields, because won't ever change this
    // so having by-field diffs isn't important
    kernelspec: Fields.Register<null | {
      default: boolean;
      name: string;
      KernelSpecFile: {
        language: string;
        argv: Array<string>;
        display_name: string;
        codemirror_mode: string | null | ReadonlyJSONObject;
        env: null | { [env_var: string]: string };
        help_links: Array<{ text: string; url: string }>;
      };
      resources: {
        "kernel.js": string;
        "kernel.css": string;
        logos: { [widthxheight: string]: string };
      };
    }>({ value: null })
  },
  status: {
    // Table with only one row
    started: Fields.String(),
    last_activity: Fields.String(),
    connections: Fields.Number(),
    kernels: Fields.Number()
  },
  terminals: {
    name: Fields.String()
  },
  kernels: {
    name: Fields.String(),
    last_activity: Fields.String(),
    connections: Fields.Number(),
    execution_state: Fields.Number()
  },
  sessions: {
    path: Fields.String(),
    name: Fields.String(),
    type: Fields.String(),
    kernel_id: Fields.String()
  },

  contents: {
    name: Fields.String(),
    path: Fields.String(),
    type: Fields.Register<null | "directory" | "file" | "notebook">({
      value: null
    }),
    writeable: Fields.Boolean(),
    created: Fields.String(),
    last_modified: Fields.String(),
    size: Fields.Register<null | number>({
      value: null
    }),
    mimetype: Fields.Register<null | string>({
      value: null
    }),
    format: Fields.Register<null | "text" | "base64" | "notebook">({
      value: null
    })
  },
  text_content: {
    // Should relation be to content or from this one?
    content_id: Fields.String(),
    content: Fields.Text()
  },
  base64_content: {
    content_id: Fields.String(),
    content: Fields.String()
  },
  folders: {
    content_id: Fields.String(),
    content: Fields.List<string>()
  },
  notebooks: {
    content_id: Fields.String(),
    nbformat: Fields.Number(),
    nbformatMinor: Fields.Number(),
    cells: Fields.List<string>(),
    metadata: Fields.Map<ReadonlyJSONValue>()
  },
  cells: {
    attachments: Fields.Map<nbformat.IMimeBundle>(),
    executionCount: Fields.Register<nbformat.ExecutionCount>({ value: null }),
    metadata: Fields.Map<ReadonlyJSONValue>(),
    mimeType: Fields.String(),
    outputs: Fields.List<string>(),
    text: Fields.Text(),
    trusted: Fields.Boolean(),
    type: Fields.Register<nbformat.CellType>({ value: "code" })
  },
  outputs: {
    trusted: Fields.Boolean(),
    type: Fields.String(),
    executionCount: Fields.Register<nbformat.ExecutionCount>({ value: null }),
    data: Fields.Register<ReadonlyJSONObject>({ value: {} }),
    metadata: Fields.Register<ReadonlyJSONObject>({ value: {} }),
    raw: Fields.Register<ReadonlyJSONObject>({ value: {} })
  }
};
