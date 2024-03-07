// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import * as React from 'react';

import { Panel } from '@lumino/widgets';

import { ReactWidget } from '@jupyterlab/apputils';

//import { PathExt } from '@jupyterlab/coreutils';

import { ISuggestions } from '@jupyter/ydoc';

//import { ICollaboratorAwareness } from './tokens';

export class SuggestionsPanel extends Panel {
  private _body: SuggestionsBody;

  constructor(fileopener: (path: string) => void, suggestions: ISuggestions) {
    super({});

    this._body = new SuggestionsBody(fileopener, suggestions);
    this.addWidget(this._body);
    this.update();
  }
}

/**
 * The suggestions list.
 */
export class SuggestionsBody extends ReactWidget {
  private _suggestions: ISuggestions;
  //private _fileopener: (path: string) => void;

  constructor(fileopener: (path: string) => void, suggestions: ISuggestions) {
    super();
    //this._fileopener = fileopener;
    suggestions.addCallback((forkId: string) => { this.update(); });
    this._suggestions = suggestions;
  }

  render(): React.ReactElement<any>[] {
    return this._suggestions.forks.map((value, i) => {
    //  let canOpenCurrent = false;
    //  let current = '';
    //  let separator = '';
    //  let currentFileLocation = '';

    //  if (value.current) {
    //    canOpenCurrent = true;
    //    const path = value.current.split(':');
    //    currentFileLocation = `${path[1]}:${path[2]}`;

    //    current = PathExt.basename(path[2]);
    //    current =
    //      current.length > 25 ? current.slice(0, 12).concat('…') : current;
    //    separator = '•';
    //  }

    //  const onClick = () => {
    //    if (canOpenCurrent) {
    //      this._fileopener(currentFileLocation);
    //    }
    //  };

    //  const displayName = `${value.user.display_name} ${separator} ${current}`;

    //  return (
    //    <div
    //      key={i}
    //      onClick={onClick}
    //    >
    //      <div
    //        style={{ backgroundColor: value.user.color }}
    //      >
    //        <span>{value.user.initials}</span>
    //      </div>
    //      <span>{displayName}</span>
    //    </div>
    //  );
      return (
        <div
          key={i}
        >
          <div>
            <span>{value}</span>
          </div>
        </div>
      );
    });
  }
}
