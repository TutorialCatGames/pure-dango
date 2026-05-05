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

# pure-dango update
if [[ "$1" == "update" || "$1" == "--update" ]]; then
    echo "Checking for updates..."
    
    # Get latest release info from GitHub API
    LATEST_RELEASE=$(curl -s https://api.github.com/repos/TutorialCatGames/pure-dango/releases/latest)
    
    if [[ $? -ne 0 ]]; then
        echo "Error: Failed to fetch release information"
        exit 1
    fi
    
    LATEST_TAG=$(echo "$LATEST_RELEASE" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
    
    if [[ -z "$LATEST_TAG" ]]; then
        echo "Error: Could not determine latest version"
        exit 1
    fi
    
    echo "Latest version: $LATEST_TAG"
    
    # Get the source code tarball URL
    DOWNLOAD_URL=$(echo "$LATEST_RELEASE" | grep '"tarball_url":' | sed -E 's/.*"([^"]+)".*/\1/')
    
    if [[ -z "$DOWNLOAD_URL" ]]; then
        echo "Error: Could not find download URL"
        exit 1
    fi
    
    echo "Downloading from: $DOWNLOAD_URL"
    
    # Create temporary directory
    TEMP_DIR=$(mktemp -d)
    DOWNLOAD_FILE="$TEMP_DIR/source.tar.gz"
    
    # Download the release
    curl -L -o "$DOWNLOAD_FILE" "$DOWNLOAD_URL"
    
    if [[ $? -ne 0 ]]; then
        echo "Error: Failed to download update"
        rm -rf "$TEMP_DIR"
        exit 1
    fi
    
    echo "Extracting update..."
    
    # Extract to temporary directory
    tar -xzf "$DOWNLOAD_FILE" -C "$TEMP_DIR"
    
    if [[ $? -ne 0 ]]; then
        echo "Error: Failed to extract update"
        rm -rf "$TEMP_DIR"
        exit 1
    fi
    
    # Backup current installation
    BACKUP_DIR="$PROJECT_ROOT.backup.$(date +%Y%m%d_%H%M%S)"
    echo "Creating backup at: $BACKUP_DIR"
    cp -r "$PROJECT_ROOT" "$BACKUP_DIR"
    
    # Find the extracted directory (GitHub tarballs extract to TutorialCatGames-pure-dango-XXXXXXX format)
    EXTRACTED_DIR=$(find "$TEMP_DIR" -type d -name "TutorialCatGames-pure-dango-*" -maxdepth 1 | head -n 1)
    
    if [[ -z "$EXTRACTED_DIR" ]]; then
        echo "Error: Could not find extracted directory"
        rm -rf "$TEMP_DIR"
        exit 1
    fi
    
    echo "Installing update..."
    
    # Copy new files over (excluding .git directory)
    rsync -av --exclude='.git' "$EXTRACTED_DIR/" "$PROJECT_ROOT/"
    
    # Run npm install to update dependencies
    cd "$PROJECT_ROOT"
    echo "Installing dependencies..."
    npm install
    
    # Build the project
    echo "Building project..."
    npm run build
    
    # Make launcher executable
    chmod +x "$LAUNCHER" 2>/dev/null
    chmod +x "$SCRIPT_DIR/pure-dango.sh" 2>/dev/null
    
    # Cleanup
    rm -rf "$TEMP_DIR"
    
    echo "Update completed successfully!"
    echo "Backup saved at: $BACKUP_DIR"
    echo ""
    echo "To rollback, run: rm -rf \"$PROJECT_ROOT\" && mv \"$BACKUP_DIR\" \"$PROJECT_ROOT\""
    
    exit 0
fi

# pure-dango -h
if [[ "$1" == "-help" || "$1" == "--help" || "$1" == "-h" ]]; then
    echo "Usage: pure-dango [OPTIONS] [file]"
    echo ""
    echo "Options:"
    echo "  -help, --help, -h : Show this help message"
    echo "  update, --update  : Update to the latest version from GitHub"
    echo "  -dev              : Run in development mode (uses Node.js directly)"
    echo "  -r [FILE]         : Rebuild the exe then run the file"
    echo "  -r                : Rebuild only"
    echo ""
    echo "Examples:"
    echo "  pure-dango hello.pds         # Run using compiled executable"
    echo "  pure-dango -dev hello.pds    # Run using Node.js (for development)"
    echo "  pure-dango -r hello.pds      # Rebuild and run"
    echo "  pure-dango update            # Update to latest version"
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

"$LAUNCHER" run "$1"