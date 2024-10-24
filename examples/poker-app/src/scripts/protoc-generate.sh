#!/usr/bin/env bash

# Root directory of app
ROOT_DIR="$(git rev-parse --show-toplevel)/examples/poker-app/src"

# Path to Protoc Plugin
PROTOC_GEN_TS_PATH="${ROOT_DIR}/node_modules/.bin/protoc-gen-ts_proto"

# Directory holding all .proto files
SRC_DIR="${ROOT_DIR}/proto"

# Directory to write generated code (.d.ts files)
OUT_DIR="${ROOT_DIR}/generated"

# Clean all existing generated files
rm -r "${OUT_DIR}"
mkdir "${OUT_DIR}"

# Generate all messages
protoc \
    --plugin="protoc-gen-ts=${PROTOC_GEN_TS_PATH}" \
    --ts_proto_out="${OUT_DIR}" \
    --proto_path="${SRC_DIR}" \
    $(find "${SRC_DIR}" -iname "*.proto")