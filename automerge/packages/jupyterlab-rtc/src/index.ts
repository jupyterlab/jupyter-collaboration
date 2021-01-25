import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { IEditorTracker } from '@jupyterlab/fileeditor';
import { INotebookTracker } from '@jupyterlab/notebook';
import { LabIcon } from '@jupyterlab/ui-components';

import Users from './users/users';
import Profile from './profile/profile';

import WsRTCClient from './client/WsRTCClient';
import authRequestAPI from './client/RestAuthClient';
import rtcRequestAPI from './client/RestRTCClient';

import profileSvg from './../style/icons/person-24px.svg';
import usersSvg from './../style/icons/people-24px.svg';

export const profileIcon = new LabIcon({
  name: 'rtc:proflie',
  svgstr: profileSvg
});

export const usersIcon = new LabIcon({
  name: 'rtc:users',
  svgstr: usersSvg
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

    rtcRequestAPI<any>('example')
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

    const profile = new Profile(wsRTCClient);
    profile.title.icon = profileIcon;
    profile.id = 'jupyter-profile'
    app.shell.add(profile, 'left', { rank: 300 })

    const users = new Users();
    users.title.icon = usersIcon;
    users.id = 'jupyter-users'
    app.shell.add(users, 'left', { rank: 300 })

    authRequestAPI<any>('users')
      .then((data: any) => {
        console.log('Got a response from the jupyter_auth server API', data);
        users.setUsers(data);
        profile.setProfile(data);
      })
      .catch((reason: any) => {
        console.error(
          `The jupyter_auth server API appears to be missing.\n${reason}`
        );
      });
    
  }

}

export default rtc;
