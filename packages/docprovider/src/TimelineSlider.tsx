/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import { ReactWidget } from '@jupyterlab/apputils';
import { TimelineSliderComponent } from './component';
import * as React from 'react';
import { IForkProvider } from './ydrive';
import { ServerConnection } from '@jupyterlab/services';

export class TimelineWidget extends ReactWidget {
  private apiURL: string;
  private provider: IForkProvider;
  private contentType: string;
  private format: string;
  private documentTimelineUrl: string;
  private _serverSettings?: ServerConnection.ISettings;

  constructor(
    apiURL: string,
    provider: IForkProvider,
    contentType: string,
    format: string,
    documentTimelineUrl: string,
    serverSettings?: ServerConnection.ISettings
  ) {
    super();
    this.apiURL = apiURL;
    this.provider = provider;
    this.contentType = contentType;
    this.format = format;
    this.documentTimelineUrl = documentTimelineUrl;
    this._serverSettings = serverSettings;
    this.addClass('jp-timelineSliderWrapper');
  }

  render(): JSX.Element {
    return (
      <TimelineSliderComponent
        key={this.apiURL}
        apiURL={this.apiURL}
        provider={this.provider}
        contentType={this.contentType}
        format={this.format}
        documentTimelineUrl={this.documentTimelineUrl}
        serverSettings={this._serverSettings}
      />
    );
  }
  updateContent(apiURL: string, provider: IForkProvider): void {
    this.apiURL = apiURL;
    this.provider = provider;
    this.contentType = this.provider.contentType;
    this.format = this.provider.format;

    this.update();
  }
}
