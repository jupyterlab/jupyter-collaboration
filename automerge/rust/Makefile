UNAME := $(shell uname)

.PHONY: build

build:
ifeq ($(UNAME),Darwin)
	cargo rustc --release -- -C link-arg=-undefined -C link-arg=dynamic_lookup
endif

clean:
	rm -rf Cargo.lock build dist target jupyter_rtc_automerge.egg-info

install:
	python setup.py install

test: test-rust test-py

test-rust:
	cargo test

test-py:
	cd .. && RUST_BACKTRACE=full python rust/jupyter_rtc_automerge/test_automerge.py

publish:
	python3 setup.py sdist bdist_wheel
	twine upload dist/*
	rm -rf dist/*

all:
	make clean && \
	  make install && \
	  make test
