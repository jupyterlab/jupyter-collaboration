#!/usr/bin/env bash

jupyter lab \
  --dev-mode \
  --ip 0.0.0.0 \
  --port 8888 \
  --config=/jupyter/rtc/automerge/jupyter_server_config.py \
  --ServerApp.token= \
  --ServerApp.jpserver_extensions="{'jupyterlab': True, 'jupyter_auth': True, 'jupyter_rtc': True}" \
  --ServerApp.login_handler_class=jupyter_auth.github.LoginHandler \
  --notebook-dir=/jupyter/rtc/automerge/examples \
  --no-browser \
  --extensions-in-dev-mode
