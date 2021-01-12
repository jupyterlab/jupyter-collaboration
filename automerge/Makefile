install:
	-conda env create -f environment.yml && \
  	conda activate jupyter-rtc
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
	conda activate jupyter-rtc
	cd packages/jupyterlab-rtc
	jupyter labextension develop --overwrite
	jupyter labextension list

start-node:
	conda activate jupyter-rtc
	yarn dev
	open http://localhost:8888/lab
	open http://localhost:3001
	open http://localhost:4321

start-lab:
	conda activate jupyter-rtc
	jupyter lab \
	  --watch \
	  --ServerApp.jpserver_extensions="{'jupyter_rtc': True}" \
	  --ServerApp.allow_origin="*" \
	  --ServerApp.token=
	open http://localhost:8888/lab
	open http://localhost:8888/jupyter_rtc/default

start-server:
	conda activate jupyter-rtc
	jupyter server \
	  --ServerApp.jpserver_extensions="{'jupyter_rtc': True}" \
	  --ServerApp.allow_origin="*"

start-ta:
	conda activate jupyter-rtc
	yarn textarea:start
	open http://localhost:3001

clean:
	rm -rf automerge-wasm-*
	rm -rf externals/automerge-wasm-*

all-node: clean install build start-node start-lab
