#!/usr/bin/env bash
set -e

NODE_SIZE=$(gzip -c dist/nodejs/orca_whirlpools_core_js_bindings_bg.wasm | wc -c)
echo "Node wasm binary gzip size: $NODE_SIZE"
WEB_SIZE=$(gzip -c dist/web/orca_whirlpools_core_js_bindings_bg.wasm | wc -c)
echo "Web wasm binary gzip side: $WEB_SIZE"
SIZE=$(( $NODE_SIZE > $WEB_SIZE ? $NODE_SIZE : $WEB_SIZE ))

# FIXME: Renable this test when we remove stdlib from the wasm binary.
# If the gzipped wasm binary is larger than 25KB, then fail the test
# if [ $SIZE -gt 25000 ]; then
#   echo "Failed because the wasm binary is larger than 25KB"
#   exit 1
# fi
