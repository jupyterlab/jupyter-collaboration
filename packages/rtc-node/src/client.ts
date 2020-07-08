// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { Datastore, IServerAdapter } from "@lumino/datastore";
import io, { Socket } from "socket.io-client";

type TransactionHandler = (transaction: Datastore.Transaction) => void;

/**
 * A class that manages exchange of transactions with the collaboration server.
 *
 * Starts without the `onRemoteTransaction` set, but once it is we should connect
 * to the underlying socket. This is set when we create the Datastore for this adapter.
 */
export class CollaborationClient implements IServerAdapter {
  state:
    | { label: "initial" }
    | {
        label: "connected";
        socket: typeof Socket;
      }
    | { label: "disposed" } = {
    label: "initial",
  };
  get isDisposed(): boolean {
    return this.state.label === "disposed";
  }

  /**
   * Set by datastore when passed to it
   */
  onUndo!: ((transaction: Datastore.Transaction) => void) | null;
  onRedo!: ((transaction: Datastore.Transaction) => void) | null;

  constructor(private options: { url: string; onLoad: () => void }) {}

  broadcast(transaction: Datastore.Transaction): void {
    if (this.state.label !== "connected") {
      throw new Error("Cannot broadcast transactions before connected");
    }
    this.state.socket.emit("transaction", transaction);
  }

  undo(): Promise<void> {
    throw new Error("Method not implemented.");
  }
  redo(): Promise<void> {
    throw new Error("Method not implemented.");
  }

  // Set by datastore when it's created.
  set onRemoteTransaction(onRemoteTransaction: TransactionHandler) {
    if (this.state.label !== "initial") {
      throw new Error(
        "Can only set remote transaction function once, after creationg"
      );
    }
    const socket = io(this.options.url);

    socket.on("transactions", (transactions: Array<Datastore.Transaction>) => {
      transactions.map((t) => onRemoteTransaction(t));
      this.options.onLoad();
    });
    socket.on("transaction", (t: Datastore.Transaction) =>
      onRemoteTransaction(t)
    );
    this.state = {
      label: "connected",
      socket,
    };
  }

  /**
   * Closes last socket and cleans up all observables.
   */
  dispose(): void {
    if (this.state.label === "disposed") {
      return;
    }
    if (this.state.label === "connected") {
      this.state.socket.close();
    }
    this.state = { label: "disposed" };
  }
}
