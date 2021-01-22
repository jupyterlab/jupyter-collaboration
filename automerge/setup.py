import os
from setuptools import setup
from jupyter_packaging import create_cmdclass

VERSION = '0.0.1'

setup_args = dict(
    name='jupyter_rtc',
    version=VERSION,
    description='Jupyter Server Extension for Realtime Collaboration',
    python_requires='>=3.8',
    install_requires=[
        'jupyter-rtc-automerge',
    ],
    include_package_data=True,
)

if __name__ == "__main__":
    setup(**setup_args)
