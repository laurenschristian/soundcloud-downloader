# SoundCloud Downloader for Raycast

A powerful Raycast extension for downloading SoundCloud tracks and playlists with high-quality audio and seamless Apple Music integration.

## Features

### 🎵 **Audio Download**
- Download individual tracks and entire playlists
- **Single MP3 files** with everything embedded (audio + cover art + metadata)
- Configurable quality presets (VBR ~190 kbps default for optimal balance)
- No separate files - everything in one clean MP3 for easy management

### 🍎 **Apple Music Integration**
- Automatic import to Apple Music library
- **Smart album naming**: Extracts actual playlist/artist names from URLs
- Auto-opens Apple Music after successful downloads
- Proper metadata tagging for seamless integration

### 📊 **Progress Tracking**
- Real-time download progress with percentage and speed
- Track-by-track progress for playlists (e.g., "Track 5/67")
- Clean, emoji-free status messages
- Toast notifications for warnings and errors

### 🔒 **Security & Performance**
- Advanced input validation and sanitization
- Memory monitoring and resource management
- Rate limiting to prevent API abuse
- Process management with cleanup

## Installation

1. Install [Raycast](https://raycast.com/) if you haven't already
2. Install [yt-dlp](https://github.com/yt-dlp/yt-dlp) for audio downloading:
   ```bash
   brew install yt-dlp
   ```
3. Clone this repository:
   ```bash
   git clone https://github.com/laurenschristian/soundcloud-downloader.git
   cd soundcloud-downloader
   ```
4. Install dependencies:
   ```bash
   npm install
   ```
5. Build and run in development mode:
   ```bash
   npm run dev
   ```

## Usage

1. Open Raycast (⌘ + Space)
2. Type "SoundCloud Downloader" or use the configured hotkey
3. Paste a SoundCloud URL (track or playlist)
4. Configure your preferences:
   - **Audio Quality**: Choose from VBR presets or custom bitrates
   - **Download Location**: Select where files are saved
   - **Apple Music**: Enable automatic import
   - **Album Art**: Include embedded thumbnails
5. Click "Download" and watch the progress
6. Files are automatically imported to Apple Music when enabled

## Supported URLs

- Individual tracks: `https://soundcloud.com/artist/track-name`
- Playlists: `https://soundcloud.com/artist/sets/playlist-name`
- User profiles: `https://soundcloud.com/artist` (downloads all tracks)

## Configuration

### Audio Quality Options
- **VBR ~130 kbps** - Good quality, smaller files
- **VBR ~190 kbps** - High quality (default)
- **VBR ~245 kbps** - Very high quality
- **320 kbps CBR** - Maximum quality
- **Custom** - Set your own bitrate

### Apple Music Setup
The extension automatically detects and creates the Apple Music import folder:
- **Path**: `~/Music/Music/Media.localized/Automatically Add to Music.localized/`
- **Auto-creation**: Folder is created if it doesn't exist
- **Auto-import**: Files are automatically imported when placed in this folder

## Technical Details

### Dependencies
- **yt-dlp**: Core downloading functionality
- **ffmpeg**: Audio processing, metadata embedding, and cover art integration
- **Raycast API**: UI and system integration

### Single File Output
- **Everything embedded**: Audio, cover art, and metadata all in one MP3 file
- **No clutter**: No separate .jpg, .json, or .txt files
- **Apple Music ready**: Perfect for drag-and-drop or auto-import
- **Easy management**: Move, copy, or organize single files

### Smart Album Organization
- **Dynamic album names**: Automatically extracts playlist/set names from URLs
- **Examples**:
  - `soundcloud.com/artist/sets/edc-las-vegas-2025` → "Edc Las Vegas 2025" album
  - `soundcloud.com/keinemusik/sets/boys-noize` → "Boys Noize" album
  - `soundcloud.com/artist/track-name` → "Artist" album
- **Fallback**: Uses artist name or "SoundCloud Downloads" if extraction fails

### Security Features
- Input sanitization to prevent shell injection
- Suspicious pattern detection
- Command argument validation
- Resource cleanup and memory management

### Performance Optimizations
- Debounced URL validation
- Memory monitoring with cleanup
- Process management with automatic termination
- Rate limiting for API calls

## Development

### Project Structure
```
src/
├── soundcloud-downloader.tsx    # Main extension component
├── utils/
│   ├── security.ts             # Security validation
│   ├── download.ts             # Download logic
│   └── apple-music.ts          # Apple Music integration
└── test/                       # Test files
```

### Building
```bash
npm run build
```

### Testing
```bash
npm test
```

### Linting
```bash
npm run lint
```

## Troubleshooting

### Common Issues

**"yt-dlp not found"**
- Install yt-dlp: `brew install yt-dlp`
- Ensure it's in your PATH

**"Apple Music import failed"**
- Check that the import folder exists and is writable
- Ensure Apple Music is installed and configured

**"Download failed"**
- Verify the SoundCloud URL is valid and accessible
- Check your internet connection
- Some tracks may be region-restricted

### Debug Mode
Enable debug logging by setting the environment variable:
```bash
export DEBUG=soundcloud-downloader
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and add tests
4. Ensure all tests pass: `npm test`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) for the powerful downloading capabilities
- [Raycast](https://raycast.com/) for the excellent extension platform
- SoundCloud for the amazing music platform

---

**Note**: This extension is for personal use only. Please respect artists' rights and SoundCloud's terms of service. Consider supporting artists through official channels.