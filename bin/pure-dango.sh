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

# pure-dango -h
if [[ "$1" == "-help" || "$1" == "--help" || "$1" == "-h" ]]; then
    echo "Usage: pure-dango [OPTIONS] [file]"
    echo ""s
    echo "Options:"
    echo "  -help, --help, -h : Show this help message"
    echo "  -dev              : Run in development mode (uses Node.js directly)"
    echo "  -r [FILE]         : Rebuild the exe then run the file"
    echo "  -r                : Rebuild only"
    echo ""
    echo "Examples:"
    echo "  pure-dango hello.pds         # Run using compiled executable"
    echo "  pure-dango -dev hello.pds    # Run using Node.js (for development)"
    echo "  pure-dango -r hello.pds      # Rebuild and run"
    exit 0
fi

# pure-dango -dev [FILE]
if [[ "$1" == "-dev" ]]; then
    cd "$PROJECT_ROOT"
    
    if [[ ! -d "node_modules" ]]; then
        echo "Dependencies not installed. Running npm install..."
        npm install
    fi
    
    if command -v tsx &> /dev/null; then
        tsx src/index.ts "$2"
    elif [[ -f "dist/PureDango.cjs" ]]; then
        node dist/PureDango.cjs "$2"
    else
        echo "Building project first..."
        SKIP_EXE=true npm run build
        node dist/PureDango.cjs "$2"
    fi
    exit 0
fi

# pure-dango -r || pure-dango -r [FILE]
if [[ "$1" == "-r" ]]; then
    cd "$PROJECT_ROOT" && npm run build
    [[ -n "$2" ]] && "$LAUNCHER" run "$2"
    exit 0
fi

#
"$LAUNCHER" run "$1"