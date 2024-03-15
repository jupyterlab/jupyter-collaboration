/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { ChatWidget } from '@jupyter/chat';
import { DocumentRegistry, DocumentWidget } from '@jupyterlab/docregistry';

import { CollaborativeChatModel } from './model';

/**
 * DocumentWidget: widget that represents the view or editor for a file type.
 */
export class CollaborativeChatWidget extends DocumentWidget<
  ChatWidget,
  CollaborativeChatModel
> {
  constructor(
    options: DocumentWidget.IOptions<ChatWidget, CollaborativeChatModel>
  ) {
    super(options);
  }

  /**
   * Dispose of the resources held by the widget.
   */
  dispose(): void {
    this.content.dispose();
    super.dispose();
  }
}

export namespace ChatPanel {
  export interface IOptions extends ChatWidget.IOptions {
    context: DocumentRegistry.IContext<CollaborativeChatModel>;
  }
}
