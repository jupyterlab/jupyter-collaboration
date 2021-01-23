import React from 'react';

import Button from '@material-ui/core/Button';

import { makeStyles, createStyles, Theme } from '@material-ui/core/styles';

const useStyles = makeStyles((theme: Theme) => 
  createStyles({
    root: {
      '& > *': {
        margin: theme.spacing(1),
      },
    },
    jbutton: {
      background: 'linear-gradient(45deg, #FE6B8B 30%, #FF8E53 90%)',
      border: 0,
      borderRadius: 3,
      boxShadow: '0 3px 5px 2px rgba(255, 105, 135, .3)',
      color: 'white',
      height: 48,
    }
  }),
  {classNamePrefix: 'JupyterRtc'}
);

const Profile = () => {
  const classes = useStyles();
  return (
    <div className={classes.root}>
      <Button variant="contained" className={classes.jbutton} color="secondary">
        Profile
      </Button>
    </div>
  );
}

export default Profile;
