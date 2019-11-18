import { AnyField, Fields } from "@phosphor/datastore";
import { ReadonlyJSONObject } from "@phosphor/coreutils";

// Q: Do we add "refrefsh xxx" method?
// N: Yes.

// Q: Do we fully normalize into tables?
// A: No, only enough to allow collaboration.
//    So anything that might need to be merged should be its own field.

export const TABLES: { [id: string]: { [name: string]: AnyField } } = {
  kernelspecs: {
    // Table with only one row
    kernelspecs: Fields.Register<null | {
      default: string;
      kernelspecs: {
        [filename: string]: {
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
        };
      };
    }>({ value: null })
  },
  status: {
    // Table with only one row
    status: Fields.Register<null | {
      started: string;
      last_activity: string;
      connections: number;
      kernels: number;
    }>({ value: null })
  },
  terminals: {
    name: Fields.String()
  }
};
