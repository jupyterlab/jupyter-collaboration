// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { ReactWidget } from '@jupyterlab/apputils';

import { DocumentRegistry } from '@jupyterlab/docregistry';

import { User } from '@jupyterlab/services';

import { LabIcon, caretDownIcon, fileIcon } from '@jupyterlab/ui-components';

import { Signal, ISignal } from '@lumino/signaling';

import { Panel } from '@lumino/widgets';

import React, { useState } from 'react';

import { Awareness } from 'y-protocols/awareness';

import { ICollaboratorAwareness } from './tokens';

/**
 * The CSS class added to collaborators panel.
 */
const COLLABORATORS_PANEL_CLASS = 'jp-CollaboratorsPanel';

/**
 * The CSS class added to collaborators list container.
 */
const COLLABORATORS_LIST_CLASS = 'jp-CollaboratorsList';

/**
 * The CSS class added to each collaborator element.
 */
const COLLABORATOR_CLASS = 'jp-Collaborator';

/**
 * The CSS class added to each collaborator header.
 */
const COLLABORATOR_HEADER_CLASS = 'jp-CollaboratorHeader';

/**
 * The CSS class added to each collaborator header collapser.
 */
const COLLABORATOR_HEADER_COLLAPSER_CLASS = 'jp-CollaboratorHeaderCollapser';

/**
 * The CSS class added to each collaborator header with document.
 */
const CLICKABLE_COLLABORATOR_CLASS = 'jp-ClickableCollaborator';

/**
 * The CSS class added to each collaborator icon.
 */
const COLLABORATOR_ICON_CLASS = 'jp-CollaboratorIcon';

/**
 * The CSS class added to the files list.
 */
const COLLABORATOR_FILES_CLASS = 'jp-CollaboratorFiles';

/**
 * The CSS class added to the files in the list.
 */
const COLLABORATOR_FILE_CLASS = 'jp-CollaboratorFile';

export class CollaboratorsPanel extends Panel {
  constructor(
    currentUser: User.IManager,
    awareness: Awareness,
    fileopener: (path: string) => void,
    docRegistry?: DocumentRegistry
  ) {
    super({});

    this._awareness = awareness;

    this._currentUser = currentUser;

    this.addClass(COLLABORATORS_PANEL_CLASS);

    this.addWidget(
      ReactWidget.create(
        <CollaboratorsBody
          fileopener={fileopener}
          collaboratorsChanged={this._collaboratorsChanged}
          docRegistry={docRegistry}
        ></CollaboratorsBody>
      )
    );

    this._awareness.on('change', this._onAwarenessChanged);
  }

  /**
   * Handle collaborator change.
   */
  private _onAwarenessChanged = () => {
    const state = this._awareness.getStates() as any;
    const collaborators: ICollaboratorAwareness[] = [];

    state.forEach((value: ICollaboratorAwareness, key: any) => {
      if (
        this._currentUser.isReady &&
        value.user.username !== this._currentUser.identity!.username
      ) {
        collaborators.push(value);
      }
    });
    this._collaboratorsChanged.emit(collaborators);
  };
  private _currentUser: User.IManager;
  private _awareness: Awareness;
  private _collaboratorsChanged = new Signal<this, ICollaboratorAwareness[]>(
    this
  );
}

export function CollaboratorsBody(props: {
  collaboratorsChanged: ISignal<CollaboratorsPanel, ICollaboratorAwareness[]>;
  fileopener: (path: string) => void;
  docRegistry?: DocumentRegistry;
}): JSX.Element {
  const [collaborators, setCollaborators] = useState<ICollaboratorAwareness[]>(
    []
  );

  props.collaboratorsChanged.connect((_, value) => {
    setCollaborators(value);
  });

  return (
    <div className={COLLABORATORS_LIST_CLASS}>
      {collaborators.map((collaborator, i) => {
        return (
          <Collaborator
            collaborator={collaborator}
            fileopener={props.fileopener}
            docRegistry={props.docRegistry}
          ></Collaborator>
        );
      })}
    </div>
  );
}

export function Collaborator(props: {
  collaborator: ICollaboratorAwareness;
  fileopener: (path: string) => void;
  docRegistry?: DocumentRegistry;
}): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const { collaborator, fileopener } = props;
  let currentMain = '';

  if (collaborator.current) {
    const path = collaborator.current.split(':');
    currentMain = `${path[1]}:${path[2]}`;
  }

  const documents: string[] = collaborator.documents || [];

  const docs = documents.map(document => {
    const path = document.split(':');
    const fileTypes = props.docRegistry
      ?.getFileTypesForPath(path[1])
      ?.filter(ft => ft.icon !== undefined);
    const icon = fileTypes ? fileTypes[0].icon! : fileIcon;
    const iconClass: string | undefined = fileTypes
      ? fileTypes[0].iconClass
      : undefined;

    return {
      filepath: path[1],
      filename:
        path[1].length > 40
          ? path[1]
              .slice(0, 10)
              .concat('…')
              .concat(path[1].slice(path[1].length - 15))
          : path[1],
      fileLocation: document,
      icon,
      iconClass
    };
  });

  const onClick = () => {
    if (docs.length) {
      setOpen(!open);
    }
  };

  return (
    <div className={COLLABORATOR_CLASS}>
      <div
        className={
          docs.length
            ? `${CLICKABLE_COLLABORATOR_CLASS} ${COLLABORATOR_HEADER_CLASS}`
            : COLLABORATOR_HEADER_CLASS
        }
        onClick={documents ? onClick : undefined}
      >
        <LabIcon.resolveReact
          icon={caretDownIcon}
          className={
            COLLABORATOR_HEADER_COLLAPSER_CLASS +
            (open ? ' jp-mod-expanded' : '')
          }
          tag={'div'}
        />
        <div
          className={COLLABORATOR_ICON_CLASS}
          style={{ backgroundColor: collaborator.user.color }}
        >
          <span>{collaborator.user.initials}</span>
        </div>
        <span>{collaborator.user.display_name}</span>
      </div>
      <div
        className={`${COLLABORATOR_FILES_CLASS} jp-DirListing`}
        style={open ? {} : { display: 'none' }}
      >
        <ul className={'jp-DirListing-content'}>
          {docs.map(doc => {
            return (
              <li
                className={
                  'jp-DirListing-item ' +
                  (doc.fileLocation === currentMain
                    ? `${COLLABORATOR_FILE_CLASS} jp-mod-running`
                    : COLLABORATOR_FILE_CLASS)
                }
                key={doc.filename}
                onClick={() => fileopener(doc.fileLocation)}
              >
                <LabIcon.resolveReact
                  icon={doc.icon}
                  iconClass={doc.iconClass}
                  tag={'span'}
                  className={'jp-DirListing-itemIcon'}
                  stylesheet={'listing'}
                />
                <span className={'jp-DirListing-itemText'} title={doc.filepath}>
                  {doc.filename}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
