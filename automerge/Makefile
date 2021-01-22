SHELL=/bin/zsh

CONDA_ACTIVATE=source $$(conda info --base)/etc/profile.d/conda.sh ; conda activate ; conda activate
CONDA_DEACTIVATE=source $$(conda info --base)/etc/profile.d/conda.sh ; conda deactivate ; conda deactivate

.PHONY: install build

install:
	-conda env create -f environment.yml 
	
	($(CONDA_ACTIVATE) jupyter-rtc; cd rust && \
	  make all && \
	  pip list | grep jupyter-rtc-automerge )

	git clone https://github.com/datalayer-contrib/automerge externals/automerge-wasm-bundler && \
	  cd externals/automerge-wasm-bundler && \
	  git checkout wasm-bundler

	git clone https://github.com/datalayer-contrib/automerge externals/automerge-wasm-nodejs && \
	  cd externals/automerge-wasm-nodejs && \
	  git checkout wasm-nodejs

	git clone https://github.com/datalayer-contrib/automerge externals/automerge && \
	  cd externals/automerge && \
	  git checkout performance-a262c
  
build:
	($(CONDA_ACTIVATE) jupyter-rtc; cd externals/automerge && yarn && yarn build)
	($(CONDA_ACTIVATE) jupyter-rtc; yarn && yarn build)
	-rm -fr packages/jupyterlab-rtc/node_modules/automerge
	-rm -fr packages/server/node_modules/automerge
	-rm -fr packages/textarea/node_modules/automerge
	($(CONDA_ACTIVATE) jupyter-rtc; pip install -e .)
	($(CONDA_ACTIVATE) jupyter-rtc; cd packages/jupyterlab-rtc && jupyter labextension develop --overwrite)
	($(CONDA_ACTIVATE) jupyter-rtc; cd packages/jupyterlab-rtc && jupyter labextension list)

start-dev:
	($(CONDA_ACTIVATE) jupyter-rtc; yarn dev )
	open http://localhost:8888/lab
	# open http://localhost:3001
	# open http://localhost:4321

start-jlab:
	($(CONDA_ACTIVATE) jupyter-rtc; jupyter lab \
	  --watch \
	  --ServerApp.jpserver_extensions="{'jupyter_rtc': True}" \
	  --ServerApp.allow_origin="*" \
	  --ServerApp.token= )
	
	open http://localhost:8888/lab
	open http://localhost:8888/jupyter_rtc/default

start-jserver:
	($(CONDA_ACTIVATE) jupyter-rtc; jupyter server \
	  --ServerApp.jpserver_extensions="{'jupyter_rtc': True}" \
	  --ServerApp.allow_origin="*" )

start-textarea:
	($(CONDA_ACTIVATE) jupyter-rtc; yarn textarea:start )
	open http://localhost:3001

clean:
	-rm -rf externals/automerge*
	-rm -rf node_modules
	-rm -rf packages/*/node_modules
	-rm tsconfig.tsbuildinfo
	-rm packages/*/tsconfig.tsbuildinfo
	conda env remove --name jupyter-rtc

all: clean install build start-node start-lab
