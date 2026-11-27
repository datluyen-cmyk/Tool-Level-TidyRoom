"""Compatibility launcher for shortcuts to the previous entry point."""
from pathlib import Path
import webbrowser

if __name__ == '__main__':
    webbrowser.open(Path(__file__).resolve().with_name('index.html').as_uri())
