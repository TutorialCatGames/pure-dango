#!/bin/bash
SCRIPT_PATH="${BASH_SOURCE[0]}"
while [ -L "$SCRIPT_PATH" ]; do
    SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
    SCRIPT_PATH="$(readlink "$SCRIPT_PATH")"
    [[ $SCRIPT_PATH != /* ]] && SCRIPT_PATH="$SCRIPT_DIR/$SCRIPT_PATH"
done
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PLATFORM="$(uname -s)"

if [[ "$PLATFORM" == "Darwin" ]]; then
    LAUNCHER="$PROJECT_ROOT/dist/PureDangoLauncher-macos"
else
    LAUNCHER="$PROJECT_ROOT/dist/PureDangoLauncher-linux"
fi

if [[ "$1" == "-help" || "$1" == "--help" || "$1" == "-h" ]]; then
    echo "Usage: pure-dango [file]"
    echo ""
    echo "Options:"
    echo "  -help, --help, -h : Show this help message"
    echo "  -r [FILE]         : Rebuilds the exe then runs the file"
    echo "  -r                : Rebuilds only"
    echo ""
    echo "Example:"
    echo "  pure-dango hello.pds"
    exit 0
fi

if [[ "$1" == "-r" ]]; then
    cd "$PROJECT_ROOT" && npm run build
    [[ -n "$2" ]] && "$LAUNCHER" run "$2"
    exit 0
fi

"$LAUNCHER" run "$1"