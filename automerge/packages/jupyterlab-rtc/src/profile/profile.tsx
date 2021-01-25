import React from 'react';

import { ReactWidget } from '@jupyterlab/apputils';

import FormGroup from '@material-ui/core/FormGroup';
import FormControlLabel from '@material-ui/core/FormControlLabel';
import Switch from '@material-ui/core/Switch';

import { INotification } from "jupyterlab_toastify";

const Available = (opts: {profile: any; ws: WebSocket}) => {

  const [state, setState] = React.useState({
    available: true
  });

  const getLabel = () => state.available? "Available" : "Not Available";

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setState({ ...state, [event.target.name]: event.target.checked });
    const payload = JSON.stringify({
      'action': 'user_status',
      'name': opts.profile.login,
      'status': state
    });
    console.log(payload)
    opts.ws.send((payload as any));
  };

  return (
    <FormGroup row>
      <FormControlLabel
        control={
          <Switch
            checked={state.available}
            onChange={handleChange}
            name="available"
            color="primary"
          />
        }
        label={getLabel()}
      />
    </FormGroup>
  );

}

const Profile = (opts: {profile: any; ws: WebSocket} ) => {
  const profile = opts.profile.me;
  opts.ws.onmessage = (message: any) => {
    if (message.data) {
      const data = JSON.parse(message.data);
      const info = `User @${data.name} is ${(data.status.available) ? 'not ': ''}available`;
      INotification.info(info);
    }
  }
  return (
    <div>
      <a href={`https://github.com/${profile.login}`} target="_blank">
        <img src={profile.avatar_url} style={{width: '100px'}}/>
        <div>{profile.name}</div>
        <div className='jp-Profile-username'>@{profile.login}</div>
        {profile.bio && <div className='jp-Profile-bio'>Bio: {profile.bio}</div>}
      </a>
      <Available profile={profile} ws={opts.ws}/>
    </div>
  );
}

class ProfileWidget extends ReactWidget {
  private profile = {};
  private ws: WebSocket;
  private uri: string;

  constructor() {
    super();
    this.uri = encodeURI(`ws://localhost:8888/jupyter_rtc/collaboration?room=_users_`);
    this.ws = new WebSocket(this.uri);
    this.ws.binaryType = 'arraybuffer';
    this.addClass('jp-Profile-Widget');
  }

  public render(): JSX.Element {
    return (
      <div>
        <Profile profile={this.profile} ws={this.ws}/>
      </div>
    )
  }

  setProfile(profile: any) {
    this.profile = profile;
    this.update();
  }

}

export default ProfileWidget;
