// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { Schema, Datastore } from "@lumino/datastore";

import { CollaborationClient } from "./client";

export async function createDatastore({
  url,
  id,
  schemas,
}: {
  url: string;
  id: number;
  schemas: ReadonlyArray<Schema>;
}): Promise<Datastore> {
  const client = new CollaborationClient({ url });
  const datastore = Datastore.create({
    id,
    schemas: schemas,
    adapter: client,
    // Pass in client as handler, so it can recieve local changes
  });
  // Wait for websocket connection to be ready
  await client.ready;
  await client.replayHistory();
  return datastore;
}
