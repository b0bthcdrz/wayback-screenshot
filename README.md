# Wayback Screenshot

A Node.js tool to capture screenshots from the Wayback Machine for a given date range. This tool allows you to capture historical snapshots of websites with proper viewport sizes based on the year.

## Installation

```bash
npm install -g wayback-screenshot
```

## Usage

```bash
wayback-screenshot <url> <startDate> <endDate> [options]
```

### Arguments

- `url`: The URL of the website to capture
- `startDate`: Start date in YYYY-MM-DD format
- `endDate`: End date in YYYY-MM-DD format

### Options

- `--output, -o`: Output directory for screenshots (default: ./screenshots)
- `--interval, -i`: Interval between captures in months (default: 1)
- `--timeout, -t`: Timeout for page load in milliseconds (default: 30000)
- `--retries, -r`: Number of retries for failed captures (default: 3)
- `--delay, -d`: Delay between retries in milliseconds (default: 5000)

### Example

```bash
wayback-screenshot example.com 2020-01-01 2020-12-31 --output ./my-screenshots --interval 2
```

## Features

- Captures screenshots from the Wayback Machine
- Automatically adjusts viewport size based on the year
- Handles connection issues with retries
- Removes Wayback Machine toolbar from screenshots
- Supports custom output directory and capture intervals

## Requirements

- Node.js >= 18.0.0
- npm >= 7.0.0

## License

MIT 