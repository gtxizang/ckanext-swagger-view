from pathlib import Path
from setuptools import setup, find_namespace_packages

HERE = Path(__file__).parent
long_description = (HERE / "README.md").read_text(encoding="utf-8")

setup(
    name="ckanext-swagger-view",
    version="0.1.0",
    description=(
        "CKAN extension that adds a Swagger API Explorer modal "
        "to DataStore resource pages"
    ),
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="Derilinx",
    author_email="info@derilinx.com",
    url="https://github.com/gtxizang/ckanext-swagger-view",
    license="MIT",
    python_requires=">=3.9",
    packages=find_namespace_packages(include=["ckanext.*"]),
    include_package_data=True,
    zip_safe=False,
    install_requires=[
        "ckan>=2.9",
    ],
    classifiers=[
        "Development Status :: 4 - Beta",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Framework :: CKAN",
    ],
    entry_points={
        "ckan.plugins": [
            "swagger_view = ckanext.swagger_view.plugin:SwaggerViewPlugin",
        ],
    },
)
