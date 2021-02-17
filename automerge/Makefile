SHELL=/bin/bash

CONDA_ACTIVATE=source $$(conda info --base)/etc/profile.d/conda.sh ; conda activate ; conda activate
CONDA_DEACTIVATE=source $$(conda info --base)/etc/profile.d/conda.sh ; conda deactivate
CONDA_REMOVE=source $$(conda info --base)/etc/profile.d/conda.sh ; conda remove -y --all -n

GITHUB_APP_CREDENTIALS=echo "export GITHUB_CLIENT_ID=YOUR_CLIENT_ID_HERE; export GITHUB_CLIENT_SECRET=YOUR_SECRET_HERE"

.PHONY: clean install

install:
	-conda env create -f environment.yml 

	($(CONDA_ACTIVATE) jupyter-rtc; \
	  cd rust && \
	  make clean && \
	  make build && \
	  make install && \
	  pip list | grep jupyter-rtc-automerge )

#	git clone https://github.com/datalayer-contrib/automerge externals/automerge-wasm-bundler && \
	  cd externals/automerge-wasm-bundler && \
	  git checkout wasm-bundler
#	git clone https://github.com/datalayer-contrib/automerge externals/automerge-wasm-nodejs && \
	  cd externals/automerge-wasm-nodejs && \
	  git checkout wasm-nodejs
#	git clone https://github.com/datalayer-contrib/automerge externals/automerge && \
	  cd externals/automerge && \
	  git checkout performance-a262c

	($(CONDA_ACTIVATE) jupyter-rtc; \
	  git clone https://github.com/automerge/automerge externals/automerge-observable-path && \
	  cd externals/automerge-observable-path && \
	  git checkout observable-path && \
	  yarn && \
	  yarn build )

	($(CONDA_ACTIVATE) jupyter-rtc; \
	  git clone https://github.com/datalayer-contrib/jupyterlab externals/jupyterlab-am-modeldb && \
	  cd externals/jupyterlab-am-modeldb && \
	  git checkout am-modeldb && \
	  pip install -e . && \
	  yarn && \
	  yarn build && \
	  jupyter lab build )

	($(CONDA_ACTIVATE) jupyter-rtc; \
	  yarn && \
	  yarn build )

	# Automerge should only be present in the top node_modules.
	-rm -fr packages/*/node_modules/automerge* || true

	($(CONDA_ACTIVATE) jupyter-rtc; \
	  git clone https://github.com/datalayer/jupyter-auth externals/jupyter-auth && \
	  cd externals/jupyter-auth && \
	  jupyter labextension develop --overwrite && \
	  yarn build && \
	  pip install -e . )

	# Uninstall the single-user jupyter-server and install a multi-user jupyter-server.
#	($(CONDA_ACTIVATE) jupyter-rtc; \
      pip uninstall -y jupyter-server && \
	  git clone https://github.com/datalayer-contrib/jupyter-server externals/jupyter-server && \
	  cd externals/jupyter-server && \
	  git checkout sessions && \
	  pip install -e . )
	($(CONDA_ACTIVATE) jupyter-rtc; \
	  pip install git+https://github.com/datalayer-contrib/jupyter-server.git@sessions )

	($(CONDA_ACTIVATE) jupyter-rtc; \
	  pip install -e . )

	($(CONDA_ACTIVATE) jupyter-rtc; \
	  cd packages/jupyterlab-rtc && \
	  jupyter labextension develop --overwrite && \
	  jupyter labextension list )

	@echo
	@echo ----------------------------------------
	@echo ✨  Jupyter RTC Environment is installed
	@echo ----------------------------------------
	@echo

start-dev:
	($(CONDA_ACTIVATE) jupyter-rtc; \
	  $(GITHUB_APP_CREDENTIALS); \
	  yarn dev )
	# open http://localhost:8888/lab
	# open http://localhost:3001
	# open http://localhost:4321

start-jupyterlab:
	($(CONDA_ACTIVATE) jupyter-rtc; \
	  $(GITHUB_APP_CREDENTIALS); \
	  jupyter lab \
	    --dev-mode \
	    --watch \
	    --ServerApp.jpserver_extensions="{'jupyterlab': True, 'jupyter_auth': True, 'jupyter_rtc': True}" \
	    --ServerApp.login_handler_class=jupyter_auth.github.LoginHandler \
	    --notebook-dir=./examples \
	    --extensions-in-dev-mode )
	# open http://localhost:8888/lab
	# open http://localhost:8888/jupyter_auth/default
	# open http://localhost:8888/jupyter_rtc/default

start-jupyterlab-80:
	($(CONDA_ACTIVATE) jupyter-rtc; \
	  $(GITHUB_APP_CREDENTIALS); \
	  jupyter lab \
	    --port 80 \
	    --dev-mode \
	    --ServerApp.jpserver_extensions="{'jupyterlab': True, 'jupyter_auth': True, 'jupyter_rtc': True}" \
	    --ServerApp.login_handler_class=jupyter_auth.github.LoginHandler \
	    --notebook-dir=./examples \
	    --extensions-in-dev-mode )

start-jupyter-server:
	($(CONDA_ACTIVATE) jupyter-rtc; \
	  jupyter server \
	    --ServerApp.jpserver_extensions="{'jupyter_rtc': True}" \
	    --ServerApp.allow_origin="*" )

start-nodejs:
	($(CONDA_ACTIVATE) jupyter-rtc; \
	  yarn automerge:start-server )
	# open http://localhost:3001

start-textarea:
	($(CONDA_ACTIVATE) jupyter-rtc; \
	  yarn textarea:start )
	# open http://localhost:3001

test-rs:
	($(CONDA_ACTIVATE) jupyter-rtc; \
	  cd rust && \
	  cargo test )

test-py:
	($(CONDA_ACTIVATE) jupyter-rtc; \
	  cd rust && \
	  make test-py )

test: test-py test-rs

kill:
	($(CONDA_ACTIVATE) jupyter-rtc; \
	  yarn kill )

clean:
	$(CONDA_DEACTIVATE)
	$(CONDA_REMOVE) jupyter-rtc || true
	-rm -rf externals/automerge* || true
	-rm -rf externals/jupyter* || true
	-rm -rf node_modules || true
	-rm -rf packages/*/node_modules || true
	-rm tsconfig.tsbuildinfo || true
	-rm packages/*/tsconfig.tsbuildinfo || true
	@echo
	@echo --------------------------------------
	@echo ✨  Jupyter RTC Environment is cleaned
	@echo --------------------------------------
	@echo

all: clean install start-jupyterlab
