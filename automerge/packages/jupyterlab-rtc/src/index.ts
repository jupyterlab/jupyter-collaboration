import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { IEditorTracker } from '@jupyterlab/fileeditor';

import { INotebookTracker } from '@jupyterlab/notebook';

import { LabIcon } from '@jupyterlab/ui-components';

import { requestAPI } from "./client/RestRTCClient";

import WsRTCClient from "./client/WsRTCClient";

import RtcWidget from "./widget";

import connectSvg from './../style/icons/connect_without_contact-black-24dp.svg';

export const connectIcon = new LabIcon({
  name: 'rtc:connect',
  svgstr: connectSvg
});

const rtc: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlab/rtc:extension',
  autoStart: true,
  requires: [
    IEditorTracker,
    INotebookTracker
  ],
  activate: (
    app: JupyterFrontEnd,
    editorTracker: IEditorTracker,
    notebookTracker: INotebookTracker
  ) => {

    requestAPI<any>('example')
      .then(data => {
        console.log('Got a response from the jupyter_rtc server API', data);
      })
      .catch(reason => {
        console.error(
          `The jupyter_rtc server API appears to be missing.\n${reason}`
        );
      });

    const wsRTCClient = new WsRTCClient(editorTracker, notebookTracker);
    console.log('JupyterLab extension @jupyterlab/rtc is activated!', wsRTCClient);

    const widget = new RtcWidget();
    widget.title.icon = connectIcon;
    widget.id = 'jupyter-rtc'
    app.shell.add(widget, 'left', { rank: 400 })

  }
}

export default rtc;
