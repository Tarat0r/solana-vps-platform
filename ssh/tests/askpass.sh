#!/bin/sh
exec node --experimental-strip-types "$(dirname "$0")/askpass.ts" "$@"
