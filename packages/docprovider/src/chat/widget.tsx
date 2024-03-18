/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { IChatModel, ChatWidget, IConfig } from '@jupyter/chat';
import { IThemeManager } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { DocumentWidget } from '@jupyterlab/docregistry';
import { FileBrowser } from '@jupyterlab/filebrowser';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import {
  addIcon,
  closeIcon,
  CommandToolbarButton,
  HTMLSelect,
  PanelWithToolbar,
  ReactWidget,
  SidePanel,
  ToolbarButton
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import { AccordionPanel, Panel } from '@lumino/widgets';
import * as React from 'react';

import { CollaborativeChatModel } from './model';

const SECTION_CLASS = 'jp-collaborativeChat-section';
const TOOLBAR_CLASS = 'jp-collaborativeChat-toolbar';

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

/**
 * Sidepanel widget including the chats and the add chat button.
 */
export class ChatPanel extends SidePanel {
  /**
   * The construcotr of the chat panel.
   */
  constructor(options: ChatPanel.IOptions) {
    super(options);

    this._commands = options.commands;
    this._rmRegistry = options.rmRegistry;
    this._themeManager = options.themeManager;

    const { commands, filebrowser } = options;
    const addChat = new CommandToolbarButton({
      commands,
      id: ChatPanel.CommandIDs.createChat,
      icon: addIcon
    });
    this.toolbar.addItem('createChat', addChat);

    const openChat = new ChatSelect({
      filebrowser,
      handleChange: this._chatSelected.bind(this)
    });
    this.toolbar.addItem('openChat', openChat);

    const content = this.content as AccordionPanel;
    content.expansionToggled.connect(this._onExpansionToogled, this);
  }

  /**
   * Getter and setter of the config, propagated to all the chat widgets.
   */
  get config(): IConfig {
    return this._config;
  }
  set config(value: Partial<IConfig>) {
    this._config = { ...this._config, ...value };
    this.widgets.forEach(w => {
      (w as ChatSection).model.config = value;
    });
  }

  /**
   * Add a new widget to the chat panel.
   *
   * @param model - the model of the chat widget
   * @param name - the name of the chat.
   */
  addChat(model: IChatModel, name: string): void {
    // Collapse all chats
    const content = this.content as AccordionPanel;
    for (let i = 0; i < this.widgets.length; i++) {
      content.collapse(i);
    }

    // Create a new widget.
    const widget = new ChatWidget({
      model: model,
      rmRegistry: this._rmRegistry,
      themeManager: this._themeManager
    });
    this.addWidget(new ChatSection({ widget, name }));
  }

  /**
   * Handle `change` events for the HTMLSelect component.
   */
  private _chatSelected = (
    event: React.ChangeEvent<HTMLSelectElement>
  ): void => {
    const value = event.target.value;
    if (value === '-') {
      return;
    }

    const index = this.widgets.findIndex(
      w => (w as ChatSection).name === value
    );
    if (index === -1) {
      this._commands.execute(ChatPanel.CommandIDs.openOrCreateChat, {
        filepath: `${value}.chat`
      });
    } else if (!this.widgets[index].isVisible) {
      (this.content as AccordionPanel).expand(index);
    }
    event.target.selectedIndex = 0;
  };

  /**
   * Triggered when a section is toogled. If the section is opened, all others
   * sections are closed.
   */
  private _onExpansionToogled(panel: AccordionPanel, index: number) {
    if (!this.widgets[index].isVisible) {
      return;
    }
    for (let i = 0; i < this.widgets.length; i++) {
      if (i !== index) {
        panel.collapse(i);
      }
    }
  }

  private _commands: CommandRegistry;
  private _config: IConfig = {};
  private _rmRegistry: IRenderMimeRegistry;
  private _themeManager: IThemeManager | null;
}

/**
 * The chat panel namespace.
 */
export namespace ChatPanel {
  /**
   * Options of the constructor of the chat panel.
   */
  export interface IOptions extends SidePanel.IOptions {
    commands: CommandRegistry;
    filebrowser: FileBrowser;
    rmRegistry: IRenderMimeRegistry;
    themeManager: IThemeManager | null;
  }
  /**
   * Command ids associated to the chat panel.
   */
  export const CommandIDs = {
    createChat: 'collaborativeChat:create',
    openOrCreateChat: 'collaborativeChat:openOrCreate'
  };
}

/**
 * The chat section containing a chat widget.
 */
class ChatSection extends PanelWithToolbar {
  /**
   * Constructor of the chat section.
   */
  constructor(options: ChatSection.IOptions) {
    super(options);
    this.addClass(SECTION_CLASS);
    this._name = options.name;
    this.title.label = this._name;
    this.title.caption = this._name;
    this.toolbar.addClass(TOOLBAR_CLASS);

    const closeButton = new ToolbarButton({
      icon: closeIcon,
      className: 'jp-mod-styled',
      onClick: () => {
        console.log('should close the chat');
      }
    });
    this.toolbar.addItem('collaborativeChat-close', closeButton);

    this.addWidget(options.widget);
    options.widget.node.style.height = '100%';
  }

  /**
   * The name of the chat.
   */
  get name(): string {
    return this._name;
  }

  /**
   * The model of the widget.
   */
  get model(): IChatModel {
    return (this.widgets[0] as ChatWidget).model;
  }

  private _name: string;
}

/**
 * The chat section namespace.
 */
export namespace ChatSection {
  /**
   * Options to build a chat section.
   */
  export interface IOptions extends Panel.IOptions {
    widget: ChatWidget;
    name: string;
  }
}

/**
 * A widget to select a chat
 */
export class ChatSelect extends ReactWidget {
  /**
   * the constructor of the widget.
   */
  constructor(options: {
    filebrowser: FileBrowser;
    handleChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  }) {
    super();
    this._filebrowser = options.filebrowser;
    this._handleChange = options.handleChange;
  }

  render(): JSX.Element {
    const items = Array.from(this._filebrowser.model.items());
    const chatNames = items
      .filter(f => f.name.endsWith('.chat'))
      .map(f => PathExt.basename(f.name, '.chat'));
    return (
      <HTMLSelect onChange={this._handleChange}>
        <option value="-">Open a chat</option>
        {chatNames.map(name => (
          <option value={name}>{name}</option>
        ))}
      </HTMLSelect>
    );
  }

  private _filebrowser: FileBrowser;
  private _handleChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
}
