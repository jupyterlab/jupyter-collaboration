FROM jupyter/scipy-notebook:d990a62010ae

USER root

RUN apt-get update && \
 apt-get install -y \
   curl git make && \
 rm -rf /var/lib/apt/lists/*

ARG REPOS_FOLDER=/jupyter
RUN mkdir -p $REPOS_FOLDER && \
  chown jovyan:users $REPOS_FOLDER

USER $NB_UID

WORKDIR $REPOS_FOLDER

RUN pip uninstall -y jupyterlab jupyterlab-server jupyter-server

RUN conda install -y jupyter-packaging \
  jupyter-server-proxy \
  nodejs=14.15.1 pip pycurl \
  rust setuptools-rust yarn=1.22.5

RUN pip install jupyterlab-lsp python-language-server[all]

RUN git clone https://github.com/jupyterlab/rtc --depth 1

WORKDIR $REPOS_FOLDER/rtc/automerge

RUN cd rust && \
  make build && \
  make install

RUN git clone https://github.com/automerge/automerge externals/automerge-observable-path && \
  cd externals/automerge-observable-path && \
  git checkout observable-path && \
  yarn && \
  yarn build

RUN git clone https://github.com/datalayer-contrib/jupyterlab externals/jupyterlab-am-modeldb && \
  cd externals/jupyterlab-am-modeldb && \
  git checkout am-modeldb-2 && \
  pip install -e . && \
  yarn && \
  yarn build && \
  jupyter lab build

RUN git clone https://github.com/datalayer/jupyter-auth externals/jupyter-auth && \
  cd externals/jupyter-auth && \
  jupyter labextension develop --overwrite && \
  yarn build && \
  pip install -e .

RUN pip install \
  git+https://github.com/datalayer-contrib/jupyter-server.git@collaborative-kernel-manager

RUN yarn && \
	yarn build && \
	rm -fr packages/*/node_modules/automerge* || true && \
	pip install -e .

RUN cd packages/jupyterlab-rtc && \
 	jupyter labextension develop --overwrite && \
 	jupyter labextension list

RUN jupyter server extension enable jupyterlab
RUN jupyter server extension enable jupyter_auth
RUN jupyter server extension enable jupyter_rtc
RUN jupyter server extension list
RUN jupyter serverextension list

ENV JUPYTERHUB_SINGLEUSER_APP "jupyter_server.serverapp.ServerApp"

# COPY ./start-jupyterlab-rtc.sh /usr/local/sbin/start-jupyterlab-rtc.sh

WORKDIR $HOME

# ENTRYPOINT ["start-jupyterlab-rtc.sh"]

# ENTRYPOINT ["jupyter", "lab", "--LabApp.dev_mode=True", "--no-browser"]
