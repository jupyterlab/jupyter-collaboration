import React from 'react';

import { ReactWidget } from '@jupyterlab/apputils';

import Profile from './profile/profile';

import Buttons from './examples/buttons';
import Snackbar1 from './examples/snack1';
import Snackbar2 from './examples/snack2';
import Snackbar3 from './examples/snack3';

class RtcWidget extends ReactWidget {

  constructor() {
    super();
    this.addClass('jp-Rtc-Widget');
  }

  public render(): JSX.Element {
    return (
      <div>
        <Profile/>
        <Snackbar1/>
        <Snackbar2/>
        <Snackbar3/>
        <Buttons/>
      </div>      
    )
  }

}

export default RtcWidget;
