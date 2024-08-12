#!/usr/bin/env bash
set -e
rm -r dist || true

mkdir -p dist
rsync -a ../../README.md ./dist

mkdir -p ./dist/api-docs
rsync -a ../ts/dist/legacy-sdk ./dist/api-docs
rsync -a ../ts/dist/ts-sdk ./dist/api-docs
rsync -a ../rust/dist/* ./dist/api-docs

rsync -a ./src/* ./dist
