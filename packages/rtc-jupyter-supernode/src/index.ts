/* eslint-disable @typescript-eslint/camelcase */
import {
  connect,
  records,
  updateRecord,
  createRecord,
} from "rtc-node";
import { schemas, DisplayType } from "rtc-jupyter";
import * as jupyter from "rx-jupyter";
import { Subscription } from "rxjs";
import * as commutable from "@nteract/commutable";

// so we can use rx-jupyter in node
// https://github.com/ReactiveX/rxjs/issues/2099#issuecomment-258033058

global.XMLHttpRequest = require("xhr2");
const config = {
  endpoint: "http://127.0.0.1:8889/",
};
/**
 * Mappping of IDs of content to the subscript for fetching them
 */
const fetchingContent = new Map<string, Subscription>();

async function main(): Promise<void> {
  const url = process.env["RTC_RELAY_URL"] || "ws://localhost:8888";
  console.log(`Connecting to ${url}`);
  const datastore = await connect({
    schemas: Object.values(schemas),
    url,
    id: 0,
  }).toPromise();
  console.log(`Fetched initial transactions`);

  records(datastore, schemas.contents).subscribe({
    next: (contents) =>
      contents
        // Find all content that needs to be fetched that we aren't fetching already
        .filter((content) => content.fetch)
        .filter((content) => !fetchingContent.has(content.$id))
        .map((content) => {
          const subscription = jupyter.contents
            .get(config, content.path)
            .subscribe({
              next: ({ response }) => {
                fetchingContent.delete(content.$id);
                if (typeof response === "string") {
                  console.log("error", response);
                  return;
                }
                // TODO: Size
                updateRecord(datastore, schemas.contents, content.$id, {
                  name: response.name,
                  path: response.path,
                  type: response.type,
                  writeable: response.writable,
                  created: response.created,
                  last_modified: response.last_modified,
                  mimetype: response.mimetype,
                  format: response.format,
                  fetch: false,
                });
                if (response.type === "file") {
                  updateRecord(
                    datastore,
                    schemas.text_content,
                    content.content,
                    {
                      // TODO: remove initial text
                      // TODO: Or make a new one?
                      content: {
                        index: 0,
                        remove: 0,
                        text: response.content as string,
                      },
                    }
                  );
                }
                if (response.type === "notebook") {
                  const notebookResponse = response.content as commutable.Notebook;
                  if (notebookResponse.nbformat == 4) {
                    const cellIDs = notebookResponse.cells.map(
                      (cell): string => {
                        if (
                          cell.cell_type === "markdown" ||
                          cell.cell_type === "raw"
                        ) {
                          return createRecord(datastore, schemas.cells, {
                            metadata: cell.metadata,
                            type: cell.cell_type,
                            text: {
                              index: 0,
                              remove: 0,
                              text: joinMultiline(cell.source),
                            },
                          });
                        }
                        const displays: Array<DisplayType> = [];
                        let result = null;
                        let error = null;
                        for (const output of cell.outputs) {
                          if (output.output_type === "execute_result") {
                            // TODO: Can results have display id in transient?
                            // TODO: Can results have different execution count than input?
                            result = {
                              data: output.data as commutable.JSONObject,
                              metadata: output.metadata,
                            };
                          } else if (output.output_type == "display_data") {
                            displays.push({
                              type: "data",
                              data: output.data as commutable.JSONObject,
                              metadata: output.metadata,
                              display_id: null,
                            });
                          } else if (output.output_type == "error") {
                            error = {
                              ename: output.ename,
                              evalue: output.evalue,
                              traceback: output.traceback,
                            };
                          } else {
                            displays.push({
                              type: "stream",
                              name: output.name,
                              text: joinMultiline(output.text),
                            });
                          }
                        }
                        const execution = createRecord(
                          datastore,
                          schemas.executions,
                          {
                            status:
                              error === null
                                ? {
                                    status: "ok",
                                    execution_count: cell.execution_count,
                                    result,
                                  }
                                : { status: "error", ...error },
                            displays: {
                              index: 0,
                              remove: 0,
                              values: displays,
                            },
                            code: joinMultiline(cell.source),
                          }
                        );
                        return createRecord(datastore, schemas.cells, {
                          metadata: cell.metadata,
                          type: cell.cell_type,
                          execution,
                          text: {
                            index: 0,
                            remove: 0,
                            text: joinMultiline(cell.source),
                          },
                        });
                      }
                    );
                    // TODO: remove cells  and existing metadata
                    updateRecord(
                      datastore,
                      schemas.notebooks,
                      content.content,
                      {
                        nbformat: notebookResponse.nbformat,
                        nbformatMinor: notebookResponse.nbformat_minor,
                        metadata: notebookResponse.metadata,
                        cells: {
                          index: 0,
                          remove: 0,
                          values: cellIDs,
                        },
                      }
                    );
                  }
                }
              },
            });
          fetchingContent.set(content.$id, subscription);
        }),
  });
}

main();

function joinMultiline(s: string | Array<string>): string {
  if (typeof s == "string") {
    return s;
  }
  return s.join("\n");
}

exports = {};
