#!/usr/bin/env bash

source $(conda info --base)/etc/profile.d/conda.sh
conda activate jupyter-rtc
cd
jupyter lab \
  --dev-mode \
  --watch \
  --allow-root \
  --ip 0.0.0.0 \
  --ServerApp.token= \
  --ServerApp.jpserver_extensions="{'jupyterlab': True, 'jupyter_auth': True, 'jupyter_rtc': True}" \
  --ServerApp.login_handler_class=jupyter_auth.github.LoginHandler \
  --notebook-dir=./examples \
  --no-browser \
  --extensions-in-dev-mode
