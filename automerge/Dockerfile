FROM ubuntu:20.04

ENV PATH="/root/miniconda3/bin:${PATH}"

RUN apt-get update
RUN apt-get install -y curl git make
RUN rm -rf /var/lib/apt/lists/*

RUN curl -L https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -o /tmp/Miniconda3-latest-Linux-x86_64.sh && \
    mkdir /root/.conda && \
    bash /tmp/Miniconda3-latest-Linux-x86_64.sh -b && \
    rm -f /tmp/Miniconda3-latest-Linux-x86_64.sh && \
    conda --version

WORKDIR /root

RUN git clone https://github.com/jupyterlab/rtc --depth 1

RUN cd /root/rtc/automerge && \
  make install

COPY docker/start-jupyterlab.sh /root/rtc/automerge/start-jupyterlab.sh

ENTRYPOINT ["/root/rtc/automerge/start-jupyterlab.sh"]
