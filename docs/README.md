# pure-dango v1.3.1.
A simple language built from JavaScript.

## Installation
First, install dependencies:
``` bash
npm install
```

Then build the executable:
``` bash
npm run build
```

### Windows:
``` bash
cd <path/to/pure-dango>
installer.bat
```

### Linux:
``` bash
chmod +x bin/pure-dango.sh
sudo ln -s "$(pwd)/bin/pure-dango.sh" /usr/local/bin/pure-dango
```

## Quick Start

This is how to run a pure-dango program:
``` bash
pure-dango <your_file.pds>
```

Example:
``` bash
pure-dango hello.pds
```

## Known Warnings

When running a `.pds` file you may see:

```bash
(node:14040) ExperimentalWarning: The Fetch API is an experimental feature.
```

This is harmless.

## Known Issues
This language may have bugs! Please report any issues you find.

## Contributing
Contributions are welcome!