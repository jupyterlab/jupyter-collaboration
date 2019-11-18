import { AnyField, Fields } from "@phosphor/datastore";
import { ReadonlyJSONObject } from "@phosphor/coreutils";

// Q: Do we add "refrefsh xxx" method?
// N: Yes.

// Q: Do we fully normalize into tables?
// A: No, only enough to allow collaboration.
//    So anything that might need to be merged should be its own field.
//    Also, we want to minimize the size of diffs.

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
    kernel_id: Fields.String(),
  }
};
