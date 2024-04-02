/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

// TODO: remove this module in favor of the one in jupyter_ydoc when released.

import { Delta, DocumentChange, MapChange, YDocument } from '@jupyter/ydoc';
import { JSONExt, JSONObject } from '@lumino/coreutils';
import * as Y from 'yjs';

/**
 * Definition of the shared Chat changes.
 */
export type ChatChange = DocumentChange & {
  /**
   * Messages list change
   */
  messagesChange?: Delta<any>;
  /**
   * Content change
   */
  contentChange?: MapChange;
};

interface IDict<T = any> {
  [key: string]: T;
}

/**
 * The collaborative chat shared document.
 */
export class YChat extends YDocument<ChatChange> {
  /**
   * Create a new collaborative chat model.
   */
  constructor(options?: YDocument.IOptions) {
    super(options);
    this._content = this.ydoc.getMap<IDict>('content');
    this._content.observe(this._contentObserver);

    this._messages = this.ydoc.getArray<IDict>('messages');
    this._messages.observe(this._messagesObserver);
  }

  /**
   * Document version
   */
  readonly version: string = '1.0.0';

  /**
   * Static method to create instances on the sharedModel
   *
   * @returns The sharedModel instance
   */
  static create(options?: YDocument.IOptions): YChat {
    return new YChat(options);
  }

  get content(): JSONObject {
    return JSONExt.deepCopy(this._content.toJSON());
  }

  get messages(): string[] {
    return JSONExt.deepCopy(this._messages.toJSON());
  }

  setMessage(value: IDict): void {
    this._messages.push([value]);
  }

  private _contentObserver = (event: Y.YMapEvent<IDict>): void => {
    this._changed.emit(this.content);
  };

  private _messagesObserver = (event: Y.YArrayEvent<IDict>): void => {
    const changes: ChatChange = {};
    changes.messagesChange = event.delta;
    this._changed.emit(changes);
  };

  private _content: Y.Map<IDict>;
  private _messages: Y.Array<IDict>;
}
