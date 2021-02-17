UNAME := $(shell uname)

.PHONY: build

build:
# ifeq ($(UNAME),Darwin)
cargo rustc --release -- -C link-arg=-undefined -C link-arg=dynamic_lookup
# endif

clean:
	rm -rf Cargo.lock build dist target jupyter_rtc_automerge.egg-info

install:
	python setup.py install

test: test-rust test-py

test-rust:
	cargo test

test-py:
	# cd .. && RUST_BACKTRACE=full python rust/jupyter_rtc_automerge/test_automerge.py

	# Checks if the backend works as expected for simple values, ensures the syntax and accessors still works.
	cd .. &&  RUST_BACKTRACE=full python -m pytest --color=yes rust/tests/test_automerge_map.py    

	# Hypothesis tests. Use the --hypothesis-seed parameter to initialize random seed and make tests reproducible
	# cd .. &&  RUST_BACKTRACE=full python -m pytest --color=yes --verbose rust/tests/test_python_objects.py   --hypothesis-seed=33810593744616933901324063339364330438
	cd .. &&  RUST_BACKTRACE=full python -m pytest --color=yes --verbose rust/tests/test_python_objects.py

	# TODO : test performances

publish:
	python3 setup.py sdist bdist_wheel
	twine upload dist/*
	rm -rf dist/*

all:
	make clean && \
	  make install && \
	  make test
