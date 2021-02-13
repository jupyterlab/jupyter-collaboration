SHELL=/bin/zsh

CONDA_ACTIVATE=source $$(conda info --base)/etc/profile.d/conda.sh ; conda activate ; conda activate
CONDA_DEACTIVATE=source $$(conda info --base)/etc/profile.d/conda.sh ; conda deactivate ; conda deactivate
GITHUB_APP_CREDENTIALS=echo "export GITHUB_CLIENT_ID=YOUR CLIENT ID HERE; export GITHUB_CLIENT_SECRET=YOUR SECRET HERE"

.PHONY: clean install

install:
	-conda env create -f environment.yml 
	
	($(CONDA_ACTIVATE) jupyter-rtc; cd rust && \
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
	  yarn && yarn build)

	($(CONDA_ACTIVATE) jupyter-rtc; \
		git clone https://github.com/datalayer-contrib/jupyterlab externals-jupyter/jupyterlab && \
		cd externals-jupyter/jupyterlab && \
		git checkout am-modeldb && \
		pip install -e . && \
		yarn && \
		yarn build)

#	($(CONDA_ACTIVATE) jupyter-rtc; \
		git clone https://github.com/datalayer/jupyter-auth externals/jupyter-auth && \
		cd externals/jupyter-auth && \
		pip install -e . && \
		jupyter labextension develop --overwrite)

#	($(CONDA_ACTIVATE) jupyter-rtc; \
	  cd externals/automerge && \
	  yarn && yarn build)

	($(CONDA_ACTIVATE) jupyter-rtc; \
	  yarn && yarn build)

	# automerge should only be present in the top node_modules.
	-rm -fr packages/*/node_modules/automerge*

	($(CONDA_ACTIVATE) jupyter-rtc; \
	  pip install -e .)

	# uninstall jupyter-server from the environment.
#	($(CONDA_ACTIVATE) jupyter-rtc; pip uninstall -y jupyter-server)
#	($(CONDA_ACTIVATE) jupyter-rtc; pip install git+https://github.com/datalayer-contrib/jupyter-server.git@sessions)
#	($(CONDA_ACTIVATE) jupyter-rtc; \
		git clone https://github.com/datalayer-contrib/jupyter-server externals/jupyter-server && \
		cd externals/jupyter-server && \
		git checkout sessions && \
		pip install -e .)

#	($(CONDA_ACTIVATE) jupyter-rtc; cd packages/jupyterlab-rtc && jupyter labextension develop --overwrite)
#	($(CONDA_ACTIVATE) jupyter-rtc; cd packages/jupyterlab-rtc && jupyter labextension list)

start-dev:
	($(CONDA_ACTIVATE) jupyter-rtc; $(GITHUB_APP_CREDENTIALS); yarn dev )
	open http://localhost:8888/lab
	# open http://localhost:3001
	# open http://localhost:4321

#	  --ServerApp.jpserver_extensions="{'jupyter_rtc': True}"
start-jlab:
	($(CONDA_ACTIVATE) jupyter-rtc; $(GITHUB_APP_CREDENTIALS); jupyter lab \
	  --dev-mode \
	  --watch \
	  --notebook-dir=./examples \
	  --ServerApp.allow_origin="*" \
	  --ServerApp.token= )
	
	open http://localhost:8888/lab
	open http://localhost:8888/jupyter_rtc/default

start-jserver:
	($(CONDA_ACTIVATE) jupyter-rtc; jupyter server \
	  --ServerApp.jpserver_extensions="{'jupyter_rtc': True}" \
	  --ServerApp.allow_origin="*" )

start-nodejs:
	($(CONDA_ACTIVATE) jupyter-rtc; yarn automerge:start-server )
	open http://localhost:3001

start-textarea:
	($(CONDA_ACTIVATE) jupyter-rtc; yarn textarea:start )
	open http://localhost:3001

test-rs:
	($(CONDA_ACTIVATE) jupyter-rtc; cd rust && cargo test )

kill:
	($(CONDA_ACTIVATE) jupyter-rtc; yarn kill )

clean:
	-rm -rf externals/automerge* || true
	-rm -rf externals/jupyter* || true
	-rm -rf externals-jupyter/jupyter* || true
	-rm -rf node_modules || true
	-rm -rf packages/*/node_modules || true
	-rm tsconfig.tsbuildinfo || true
	-rm packages/*/tsconfig.tsbuildinfo || true
	conda env remove --name jupyter-rtc || true

all: clean install build start-node start-lab
