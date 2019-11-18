import { AnyField, Fields } from "@phosphor/datastore";

export const TABLES: { [id: string]: { [name: string]: AnyField } } = {
  kernelspecs: {
    // path for kernel.js file
    kernelJS: Fields.String(),
    // path for kernel.css file
    kernelCSS: Fields.String(),
    // mapping from `widthxheight` to filename
    logos: Fields.Map<string>()
  }
};
