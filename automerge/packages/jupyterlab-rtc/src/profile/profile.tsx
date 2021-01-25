import React from 'react';

import { ReactWidget } from '@jupyterlab/apputils';

import FormGroup from '@material-ui/core/FormGroup';
import FormControlLabel from '@material-ui/core/FormControlLabel';
import Switch from '@material-ui/core/Switch';

import NotficationsSnackbar from './snack';

import WsRTCClient from './../client/WsRTCClient';

const Available = (opts: {profile: any; ws: WsRTCClient}) => {

  const [state, setState] = React.useState({
    available: true
  });

  const getLabel = () => state.available? "Available" : "Not Available";

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setState({ ...state, [event.target.name]: event.target.checked });
    opts.ws.setUserStatus(opts.profile, state.available);
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

const Profile = (opts: {profile: any; ws: WsRTCClient} ) => {
  const profile = opts.profile.me;
  return (
    <div>
      <a href={`https://github.com/${profile.login}`} target="_blank">
        <img src={profile.avatar_url} style={{width: '100px'}}/>
        <div>{profile.name}</div>
        <div className='jp-Profile-username'>@{profile.login}</div>
        {profile.bio && <div className='jp-Profile-bio'>Bio: {profile.bio}</div>}
      </a>
      <Available profile={profile} ws={opts.ws}/>
      <NotficationsSnackbar />
    </div>
  );
}

class ProfileWidget extends ReactWidget {
  private profile = {};
  private wsRTCClient: WsRTCClient;

  constructor(wsRTCClient: WsRTCClient) {
    super();
    this.wsRTCClient = wsRTCClient;
    this.addClass('jp-Profile-Widget');
  }

  public render(): JSX.Element {
    return (
      <div>
        <Profile profile={this.profile} ws={this.wsRTCClient} />
      </div>
    )
  }

  setProfile(profile: any) {
    this.profile = profile;
    this.update();
  }

}

export default ProfileWidget;
