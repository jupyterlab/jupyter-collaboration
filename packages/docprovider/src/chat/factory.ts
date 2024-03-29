/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { ChatWidget, IChatModel } from 'chat-jupyter';
import { IThemeManager } from '@jupyterlab/apputils';
import { ABCWidgetFactory, DocumentRegistry } from '@jupyterlab/docregistry';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { Contents } from '@jupyterlab/services';
import { Awareness } from 'y-protocols/awareness';

import { CollaborativeChat, CollaborativeChatModel } from './model';
import { CollaborativeChatWidget } from './widget';

/**
 * A widget factory to create new instances of CollaborativeChatWidget.
 */
export class ChatWidgetFactory extends ABCWidgetFactory<
  CollaborativeChatWidget,
  CollaborativeChatModel
> {
  /**
   * Constructor of ChatWidgetFactory.
   *
   * @param options Constructor options
   */
  constructor(options: ChatWidgetFactory.IOptions) {
    super(options);
    this._themeManager = options.themeManager;
    this._rmRegistry = options.rmRegistry;
  }

  /**
   * Create a new widget given a context.
   *
   * @param context Contains the information of the file
   * @returns The widget
   */
  protected createNewWidget(
    context: ChatWidgetFactory.IContext
  ): CollaborativeChatWidget {
    context.chatModel = context.model;
    context.rmRegistry = this._rmRegistry;
    context.themeManager = this._themeManager;
    return new CollaborativeChatWidget({
      context,
      content: new ChatWidget(context)
    });
  }

  private _themeManager: IThemeManager | null;
  private _rmRegistry: IRenderMimeRegistry;
}

export namespace ChatWidgetFactory {
  export interface IContext
    extends DocumentRegistry.IContext<CollaborativeChatModel> {
    chatModel: IChatModel;
    themeManager: IThemeManager | null;
    rmRegistry: IRenderMimeRegistry;
  }

  export interface IOptions extends DocumentRegistry.IWidgetFactoryOptions {
    themeManager: IThemeManager | null;
    rmRegistry: IRenderMimeRegistry;
  }
}

export class CollaborativeChatModelFactory
  implements DocumentRegistry.IModelFactory<CollaborativeChatModel>
{
  constructor(options: CollaborativeChatModel.IOptions) {
    this._awareness = options.awareness;
  }

  collaborative = true;
  /**
   * The name of the model.
   *
   * @returns The name
   */
  get name(): string {
    return 'chat-model';
  }

  /**
   * The content type of the file.
   *
   * @returns The content type
   */
  get contentType(): Contents.ContentType {
    return 'chat';
  }

  /**
   * The format of the file.
   *
   * @returns the file format
   */
  get fileFormat(): Contents.FileFormat {
    return 'text';
  }

  /**
   * Get whether the model factory has been disposed.
   *
   * @returns disposed status
   */

  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Dispose the model factory.
   */
  dispose(): void {
    this._disposed = true;
  }

  /**
   * Get the preferred language given the path on the file.
   *
   * @param path path of the file represented by this document model
   * @returns The preferred language
   */
  preferredLanguage(path: string): string {
    return '';
  }

  /**
   * Create a new instance of CollaborativeChatModel.
   *
   * @param languagePreference Language
   * @param modelDB Model database
   * @returns The model
   */

  createNew(
    options: DocumentRegistry.IModelOptions<CollaborativeChat>
  ): CollaborativeChatModel {
    return new CollaborativeChatModel({
      ...options,
      awareness: this._awareness
    });
  }

  private _disposed = false;
  private _awareness: Awareness;
}
