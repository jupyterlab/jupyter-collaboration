SHELL=/bin/zsh
CONDA_ACTIVATE=source $$(conda info --base)/etc/profile.d/conda.sh ; conda activate ; conda activate
CONDA_DEACTIVATE=source $$(conda info --base)/etc/profile.d/conda.sh ; conda deactivate ; conda deactivate

install:
	-conda env create -f environment.yml && \
  	($(CONDA_ACTIVATE) jupyter-rtc)
	cd rust && \
	  make all && \
	  pip list | grep glootalk && \
	  cd ./../externals
	git clone https://github.com/datalayer-contrib/automerge automerge-wasm-bundler && \
	  cd automerge-wasm-bundler && \
	  git checkout wasm-bundler && \
	  cd ./..
	git clone https://github.com/datalayer-contrib/automerge automerge-wasm-nodejs && \
	  cd automerge-wasm-nodejs && \
	  git checkout wasm-nodejs && \
	  cd ./../..
	cp -R automerge-wasm-* externals/
	yarn && \
	  yarn build
	pip install -e .

build:
	($(CONDA_ACTIVATE) jupyter-rtc)
	cd packages/jupyterlab-rtc
	jupyter labextension develop --overwrite
	jupyter labextension list

start-node:
	($(CONDA_ACTIVATE) jupyter-rtc)
	yarn dev
	open http://localhost:8888/lab
	open http://localhost:3001
	open http://localhost:4321

start-lab:
	($(CONDA_ACTIVATE) jupyter-rtc)
	jupyter lab \
	  --watch \
	  --ServerApp.jpserver_extensions="{'jupyter_rtc': True}" \
	  --ServerApp.allow_origin="*" \
	  --ServerApp.token=
	open http://localhost:8888/lab
	open http://localhost:8888/jupyter_rtc/default

start-server:
	($(CONDA_ACTIVATE) jupyter-rtc)
	jupyter server \
	  --ServerApp.jpserver_extensions="{'jupyter_rtc': True}" \
	  --ServerApp.allow_origin="*"

start-ta:
	($(CONDA_ACTIVATE) jupyter-rtc)
	yarn textarea:start
	open http://localhost:3001

clean:
	-rm -rf automerge-wasm-*
	-rm -rf externals/automerge-wasm-*


all-node: clean install build start-node start-lab
