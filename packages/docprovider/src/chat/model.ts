/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { ChatModel, IChatMessage, INewMessage, IUser } from '@jupyter/chat';
import { Delta, MapChange, StateChange, YDocument } from '@jupyter/ydoc';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { IChangedArgs } from '@jupyterlab/coreutils';
import {
  JSONExt,
  JSONObject,
  PartialJSONObject,
  UUID
} from '@lumino/coreutils';
import { ISignal, Signal } from '@lumino/signaling';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

/**
 * Collaborative chat namespace.
 */
export namespace CollaborativeChatModel {
  export interface IOptions extends ChatModel.IOptions {
    awareness: Awareness;
    sharedModel?: CollaborativeChat;
    languagePreference?: string;
  }
}

/**
 * The collaborative chat model.
 */
export class CollaborativeChatModel
  extends ChatModel
  implements DocumentRegistry.IModel
{
  constructor(options: CollaborativeChatModel.IOptions) {
    super(options);

    this._awareness = options.awareness;
    const { sharedModel } = options;

    if (sharedModel) {
      this._sharedModel = sharedModel;
    } else {
      this._sharedModel = CollaborativeChat.create();
    }

    this.sharedModel.changed.connect(this._onchange, this);

    this._user = this._awareness.states.get(this._awareness.clientID)?.user;
  }

  readonly collaborative = true;

  get sharedModel(): CollaborativeChat {
    return this._sharedModel;
  }

  get contentChanged(): ISignal<this, void> {
    return this._contentChanged;
  }

  get stateChanged(): ISignal<this, IChangedArgs<any, any, string>> {
    return this._stateChanged;
  }

  get dirty(): boolean {
    return this._dirty;
  }
  set dirty(value: boolean) {
    this._dirty = value;
  }

  get readOnly(): boolean {
    return this._readOnly;
  }
  set readOnly(value: boolean) {
    this._readOnly = value;
  }

  get disposed(): ISignal<CollaborativeChatModel, void> {
    return this._disposed;
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    super.dispose();
    this._sharedModel.dispose();
    this._disposed.emit();
    Signal.clearData(this);
  }

  toString(): string {
    return JSON.stringify({}, null, 2);
  }

  fromString(data: string): void {
    /** */
  }

  toJSON(): PartialJSONObject {
    return JSON.parse(this.toString());
  }

  fromJSON(data: PartialJSONObject): void {
    // nothing to do
  }

  initialize(): void {
    //
  }

  /**
   * A function called before transferring the message to the panel(s).
   * Can be useful if some actions are required on the message.
   *
   * It is used in this case to retrieve the user avatar color, unknown on server side.
   */
  protected formatChatMessage(message: IChatMessage): IChatMessage {
    if (this._awareness) {
      const sender = Array.from(this._awareness.states.values()).find(
        awareness => awareness.user.username === message.sender.username
      )?.user;
      if (sender) {
        message.sender.color = sender.color;
      }
    }
    return message;
  }

  addMessage(message: INewMessage): Promise<boolean | void> | boolean | void {
    const msg: IChatMessage = {
      type: 'msg',
      id: UUID.uuid4(),
      body: message.body,
      time: Date.now() / 1000,
      sender: this._user
    };

    this.sharedModel.transact(() => void this.sharedModel.setMessage(msg));
  }

  private _onchange = (
    _: CollaborativeChat,
    change: ICollaborativeChatModelChange
  ) => {
    if (change.messageChange) {
      const msgDelta = change.messageChange;
      // let retain: number;
      const messages: IChatMessage[] = [];
      msgDelta.forEach(data => {
        if (data.retain) {
          // retain = data.retain;
        } else if (data.insert) {
          messages.push(...data.insert);
        }
      });

      if (messages) {
        messages.forEach(message => {
          this.onMessage(message);
        });
      }
    }
  };

  readonly defaultKernelName: string = '';
  readonly defaultKernelLanguage: string = '';

  private _sharedModel: CollaborativeChat;

  private _dirty = false;
  private _readOnly = false;
  private _disposed = new Signal<this, void>(this);
  private _contentChanged = new Signal<this, void>(this);
  private _stateChanged = new Signal<this, IChangedArgs<any>>(this);

  private _awareness: Awareness;
  private _user: IUser;
}

interface ICollaborativeChatModelChange {
  messageChange?: Delta<any>;
  contentChange?: MapChange;
  stateChange?: StateChange<any>[];
}

interface IDict<T = any> {
  [key: string]: T;
}

/**
 * The collaborative chat shared document.
 */
export class CollaborativeChat extends YDocument<ICollaborativeChatModelChange> {
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
  static create(options?: YDocument.IOptions): CollaborativeChat {
    return new CollaborativeChat(options);
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
    const changes: ICollaborativeChatModelChange = {};
    changes.messageChange = event.delta;
    this._changed.emit(changes);
  };

  private _content: Y.Map<IDict>;
  private _messages: Y.Array<IDict>;
}
