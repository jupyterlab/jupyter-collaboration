// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { IServerAdapter, Datastore } from "@lumino/datastore";
import io, { Socket } from "socket.io-client";

type TransactionHandler = ((transaction: Datastore.Transaction) => void) | null;

/**
 * A class that manages exchange of transactions with the collaboration server.
 */
export class CollaborationClient implements IServerAdapter {
  private socket: typeof Socket;
  private _onRemoteTransaction: TransactionHandler = null;
  isDisposed: boolean = false;
  onUndo!: ((transaction: Datastore.Transaction) => void) | null;
  onRedo!: ((transaction: Datastore.Transaction) => void) | null;
  private resolveReady!: () => void;
  ready: Promise<void>;
  constructor({ url }: { url: string }) {
    this.socket = io(url);
    this.ready = new Promise((resolve) => (this.resolveReady = resolve));
  }
  broadcast(transaction: Datastore.Transaction): void {
    this.socket.emit("transaction", transaction);
  }
  undo(id: string): Promise<void> {
    throw new Error("Method not implemented.");
  }
  redo(id: string): Promise<void> {
    throw new Error("Method not implemented.");
  }

  get onRemoteTransaction(): TransactionHandler {
    return this._onRemoteTransaction;
  }

  // Set by datastore when it's created.
  set onRemoteTransaction(fn: TransactionHandler) {
    this._onRemoteTransaction = fn;
    if (fn) {
      this.socket.on(
        "transactions",
        (transactions: Array<Datastore.Transaction>) => {
          transactions.map(fn);
          this.resolveReady();
        }
      );
      this.socket.on("transaction", fn);
    }
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.socket.close();
  }
}
