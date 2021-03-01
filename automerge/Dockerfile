FROM ubuntu:18.04

ENV PATH="/root/miniconda3/bin:${PATH}"

RUN apt-get update
RUN apt-get install -y curl git make
RUN rm -rf /var/lib/apt/lists/*

RUN curl -L https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -o /tmp/Miniconda3-latest-Linux-x86_64.sh && \
    mkdir /root/.conda && \
    bash /tmp/Miniconda3-latest-Linux-x86_64.sh -b && \
    rm -f /tmp/Miniconda3-latest-Linux-x86_64.sh 
RUN conda --version

RUN git clone https://github.com/jupyterlab/rtc --depth 1
RUN cd rtc/automerge && \
  make install

RUN mkdir /root/examples

COPY docker/start-jupyterlab.sh /root/start-jupyterlab.sh
ENTRYPOINT ["/root/start-jupyterlab.sh"]
