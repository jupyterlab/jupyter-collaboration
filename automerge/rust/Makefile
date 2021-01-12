UNAME := $(shell uname)

build:
ifeq ($(UNAME),Darwin)
	cargo rustc --release -- -C link-arg=-undefined -C link-arg=dynamic_lookup
endif
all:
	make clean && python setup.py install && cd .. && RUST_BACKTRACE=full python run_glootalk.py
clean:
	rm -rf build dist glootalk.egg-info target Cargo.lock
pypi:
	python3 setup.py sdist bdist_wheel
	twine upload dist/*
	rm -rf dist/*
