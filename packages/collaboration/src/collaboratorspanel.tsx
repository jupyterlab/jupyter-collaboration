// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { ReactWidget } from '@jupyterlab/apputils';

import { DocumentRegistry } from '@jupyterlab/docregistry';

import { User } from '@jupyterlab/services';

import {
  LabIcon,
  caretDownIcon,
  fileIcon,
  searchIcon
} from '@jupyterlab/ui-components';

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

/**
 * The CSS class added to collaborator cursor follow button.
 */
const COLLABORATOR_FOLLOW_CURSOR_CLASS = 'jp-CollaboratorFollowCursor';

export class CollaboratorsPanel extends Panel {
  constructor(
    currentUser: User.IManager,
    awareness: Awareness,
    fileopener: (path: string) => void,
    docRegistry?: DocumentRegistry,
    followCursor?: (collaborator: ICollaboratorAwareness) => void,
    followCursorTitle?: string
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
          followCursor={followCursor}
          followCursorTitle={followCursorTitle}
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
    const collaboratorsMap = new Map<string, ICollaboratorAwareness>();

    state.forEach((value: Partial<ICollaboratorAwareness>, key: any) => {
      const currentIdentity = this._currentUser.identity;
      if (
        this._currentUser.isReady &&
        value.user &&
        currentIdentity &&
        value.user.username !== currentIdentity.username
      ) {
        const uniqueKey = `${value.user.username}-${
          value.current || 'no-current'
        }`;
        const clientId =
          typeof key === 'number' && Number.isInteger(key) ? key : undefined;
        const collaborator = {
          ...(value as ICollaboratorAwareness),
          clientId
        };
        const existing = collaboratorsMap.get(uniqueKey);
        const existingClientId = existing?.clientId ?? Number.POSITIVE_INFINITY;
        const collaboratorClientId =
          collaborator.clientId ?? Number.POSITIVE_INFINITY;
        if (!existing || existingClientId > collaboratorClientId) {
          collaboratorsMap.set(uniqueKey, collaborator);
        }
      }
    });
    // Convert map to array to maintain the same emit interface
    this._collaboratorsChanged.emit(Array.from(collaboratorsMap.values()));
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
  followCursor?: (collaborator: ICollaboratorAwareness) => void;
  followCursorTitle?: string;
}): JSX.Element {
  const [collaborators, setCollaborators] = useState<ICollaboratorAwareness[]>(
    []
  );

  props.collaboratorsChanged.connect((_, value) => {
    setCollaborators(value);
  });

  return (
    <div className={COLLABORATORS_LIST_CLASS}>
      {collaborators.map(collaborator => {
        const uniqueKey = `${collaborator.user.username}-${
          collaborator.current || 'no-current'
        }`;
        return (
          <Collaborator
            key={uniqueKey}
            collaborator={collaborator}
            fileopener={props.fileopener}
            docRegistry={props.docRegistry}
            followCursor={props.followCursor}
            followCursorTitle={props.followCursorTitle}
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
  followCursor?: (collaborator: ICollaboratorAwareness) => void;
  followCursorTitle?: string;
}): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const { collaborator, fileopener, followCursor, followCursorTitle } = props;
  let currentMain = '';

  if (collaborator.current) {
    // Discard widget tracker prefix (e.g. `notebook:` or `editor:`)
    const separator = collaborator.current.indexOf(':');
    if (separator !== -1) {
      currentMain = collaborator.current.slice(separator + 1);
    }
  }

  const documents: string[] = collaborator.documents || [];

  const docs = documents.map(document => {
    const fileTypes = props.docRegistry
      ?.getFileTypesForPath(document)
      ?.filter(ft => ft.icon !== undefined);
    const icon = fileTypes?.length ? fileTypes[0].icon : fileIcon;
    const iconClass: string | undefined = fileTypes?.length
      ? fileTypes[0].iconClass
      : undefined;

    return {
      filename:
        document.length > 40
          ? document
              .slice(0, 10)
              .concat('…')
              .concat(document.slice(document.length - 15))
          : document,
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

  const onFollowCursor = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    followCursor?.(collaborator);
  };

  return (
    <div className={COLLABORATOR_CLASS}>
      <div
        className={
          docs.length
            ? `${CLICKABLE_COLLABORATOR_CLASS} ${COLLABORATOR_HEADER_CLASS}`
            : COLLABORATOR_HEADER_CLASS
        }
        onClick={docs.length ? onClick : undefined}
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
        {followCursor && collaborator.current ? (
          <button
            className={COLLABORATOR_FOLLOW_CURSOR_CLASS}
            onClick={onFollowCursor}
            title={followCursorTitle}
            type={'button'}
          >
            <LabIcon.resolveReact icon={searchIcon} tag={'span'} />
          </button>
        ) : null}
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
                <span
                  className={'jp-DirListing-itemText'}
                  title={doc.fileLocation}
                >
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
