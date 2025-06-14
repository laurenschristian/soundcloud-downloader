import { Action, ActionPanel, Detail, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useState, useEffect, useRef } from "react";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { validateCommandArgs } from "./utils/security";
import { optimizePerformance } from "./utils/performance";

// Types
interface TrackInfo {
  title?: string;
  uploader?: string;
  duration?: number;
  view_count?: number;
  like_count?: number;
  description?: string;
  upload_date?: string;
  thumbnail?: string;
  webpage_url?: string;
  id?: string;
  playlist_title?: string;
  playlist_count?: number;
  playlist_index?: number;
}

interface DownloadProgress {
  percentage?: number;
  speed?: string;
  eta?: string;
  downloaded?: string;
  total?: string;
  currentTrack?: number;
  totalTracks?: number;
  trackTitle?: string;
  elapsedTime?: string;
}

interface OperationState {
  isActive: boolean;
  progress: DownloadProgress;
  trackInfo: TrackInfo | null;
  error: string | null;
  isCompleted: boolean;
  downloadedFiles: string[];
}

// Global state management for background operations
const globalOperations = new Map<string, OperationState>();
const globalListeners = new Map<string, Set<(state: OperationState) => void>>();

// Utility functions
const generateOperationId = () => `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const subscribeToOperation = (operationId: string, callback: (state: OperationState) => void) => {
  if (!globalListeners.has(operationId)) {
    globalListeners.set(operationId, new Set());
  }
  globalListeners.get(operationId)!.add(callback);
  
  // Return current state if available
  const currentState = globalOperations.get(operationId);
  if (currentState) {
    callback(currentState);
  }
  
  // Return unsubscribe function
  return () => {
    const listeners = globalListeners.get(operationId);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) {
        globalListeners.delete(operationId);
      }
    }
  };
};

const updateOperationState = (operationId: string, updates: Partial<OperationState>) => {
  const currentState = globalOperations.get(operationId) || {
    isActive: false,
    progress: {},
    trackInfo: null,
    error: null,
    isCompleted: false,
    downloadedFiles: []
  };
  
  const newState = { ...currentState, ...updates };
  globalOperations.set(operationId, newState);
  
  // Notify all listeners
  const listeners = globalListeners.get(operationId);
  if (listeners) {
    listeners.forEach(callback => callback(newState));
  }
};

// Quality presets
const QUALITY_PRESETS = {
  high: {
    name: "High Quality (VBR ~190 kbps)",
    args: ["-f", "best[abr<=192]/best", "--audio-quality", "0", "--audio-format", "mp3"]
  },
  medium: {
    name: "Medium Quality (VBR ~128 kbps)",
    args: ["-f", "best[abr<=128]/best", "--audio-quality", "5", "--audio-format", "mp3"]
  },
  low: {
    name: "Low Quality (VBR ~96 kbps)",
    args: ["-f", "best[abr<=96]/best", "--audio-quality", "9", "--audio-format", "mp3"]
  }
};

// Default settings
const DEFAULT_SETTINGS = {
  quality: "high" as keyof typeof QUALITY_PRESETS,
  downloadPath: join(homedir(), "Downloads", "SoundCloud"),
  openInAppleMusic: true,
  embedThumbnail: true,
  addMetadata: true
};

// Main component
export default function SoundCloudDownloader() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [currentOperationId, setCurrentOperationId] = useState<string | null>(null);
  const [operationState, setOperationState] = useState<OperationState>({
    isActive: false,
    progress: {},
    trackInfo: null,
    error: null,
    isCompleted: false,
    downloadedFiles: []
  });
  
  const isMountedRef = useRef(true);
  const { push } = useNavigation();

  // Subscribe to operation updates
  useEffect(() => {
    if (!currentOperationId) return;
    
    const unsubscribe = subscribeToOperation(currentOperationId, (state) => {
      if (isMountedRef.current) {
        setOperationState(state);
      }
    });
    
    return unsubscribe;
  }, [currentOperationId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Validate SoundCloud URL
  const isValidSoundCloudUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.hostname === "soundcloud.com" || parsed.hostname === "www.soundcloud.com";
    } catch {
      return false;
    }
  };

  // Check if URL is a playlist
  const isPlaylistUrl = (url: string): boolean => {
    return url.includes("/sets/") || url.includes("/albums/");
  };

  // Get yt-dlp path
  const getYtDlpPath = (): string => {
    const possiblePaths = [
      "/opt/homebrew/bin/yt-dlp",
      "/usr/local/bin/yt-dlp",
      "/usr/bin/yt-dlp",
      "yt-dlp"
    ];
    
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        return path;
      }
    }
    
    return "yt-dlp"; // Fallback to PATH
  };

  // Parse progress from yt-dlp output
  const parseProgress = (line: string): Partial<DownloadProgress> => {
    const progress: Partial<DownloadProgress> = {};
    
    // Match download progress: [download] 45.2% of 5.67MiB at 1.23MiB/s ETA 00:03
    const downloadMatch = line.match(/\[download\]\s+(\d+\.\d+)%\s+of\s+([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)(?:\s+ETA\s+(\d+:\d+))?/);
    if (downloadMatch) {
      progress.percentage = parseFloat(downloadMatch[1]);
      progress.total = downloadMatch[2];
      progress.speed = downloadMatch[3];
      if (downloadMatch[4]) {
        progress.eta = downloadMatch[4];
      }
      return progress;
    }
    
    // Match playlist progress: [download] Downloading item 5 of 67
    const playlistMatch = line.match(/\[download\]\s+Downloading\s+(?:video\s+)?(\d+)\s+of\s+(\d+)/);
    if (playlistMatch) {
      progress.currentTrack = parseInt(playlistMatch[1]);
      progress.totalTracks = parseInt(playlistMatch[2]);
      return progress;
    }
    
    // Match track title extraction
    const titleMatch = line.match(/\[info\]\s+([^:]+):\s+Downloading\s+webpage/);
    if (titleMatch) {
      progress.trackTitle = titleMatch[1].trim();
      return progress;
    }
    
    return progress;
  };

  // Calculate elapsed time
  const calculateElapsedTime = (startTime: number): string => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Open files in Apple Music
  const openInAppleMusic = async (files: string[]) => {
    if (!settings.openInAppleMusic || files.length === 0) return;
    
    try {
      console.log("🍎 Opening files in Apple Music:", files);
      
      // Import each file to Apple Music
      for (const file of files) {
        if (existsSync(file)) {
          const { spawn } = require('child_process');
          const openProcess = spawn('open', ['-a', 'Music', file], {
            stdio: 'ignore',
            detached: true
          });
          openProcess.unref();
        }
      }
      
      // Wait a moment for files to be imported, then open Apple Music
      setTimeout(() => {
        const { spawn } = require('child_process');
        const musicProcess = spawn('open', ['-a', 'Music'], {
          stdio: 'ignore',
          detached: true
        });
        musicProcess.unref();
        console.log("🍎 Apple Music opened");
      }, 2000);
      
    } catch (error) {
      console.error("❌ Error opening Apple Music:", error);
    }
  };

  // Execute download in background
  // Extract album name from SoundCloud URL or metadata
 
  
  const executeBackgroundDownload = async (
    operationId: string,
    sanitizedUrl: string,
    safePath: string,
    isPlaylist: boolean,
  ) => {
    const startTime = Date.now();
    let trackInfo: TrackInfo | null = null;
    const downloadedFiles: string[] = [];
    
    try {
      updateOperationState(operationId, { 
        isActive: true, 
        error: null,
        progress: { elapsedTime: "0:00" }
      });
      
      const ytDlpPath = getYtDlpPath();
      console.log("🔧 Using yt-dlp at:", ytDlpPath);
      
      // Build command arguments
      const args: string[] = [];
      
      // Basic extraction and output settings
      args.push("--extract-flat", "false"); // Get full metadata
      args.push("-o", `${safePath}/%(title)s.%(ext)s`); // Use title for filename
      
      // Quality settings
      const qualityArgs = QUALITY_PRESETS[settings.quality].args;
      args.push(...qualityArgs);
      
      // Enhanced metadata settings for Apple Music compatibility
      args.push("--add-metadata");
      
      // SIMPLE AND DIRECT: Copy the song title to album field
      // This ensures each song becomes its own "album" in Apple Music
      if (isPlaylist) {
        // For playlists, use the playlist title as album
        args.push("--parse-metadata", "playlist_title:%(album)s");
      } else {
        // For individual tracks, use the song title as album
        args.push("--parse-metadata", "title:%(album)s");
      }
      
      // Additional ffmpeg metadata to ensure it sticks
      args.push("--postprocessor-args", `ffmpeg:-metadata genre="Electronic"`);
      
      // Album art embedding - CRITICAL: Embed into MP3, don't create separate files
      if (settings.embedThumbnail) {
        args.push("--embed-thumbnail"); // Embed artwork INTO the MP3 file
        args.push("--no-write-thumbnail"); // DON'T create separate .jpg files
      }
      
      // Prevent creation of separate metadata files - SINGLE FILE OUTPUT ONLY
      args.push("--no-write-info-json"); // No .info.json files
      args.push("--no-write-description"); // No .description files
      args.push("--no-write-annotations"); // No .annotations.xml files
      args.push("--no-write-comments"); // No .comments files
      
      // Embed subtitles but don't write separate files
      args.push("--embed-subs"); // Embed subtitle data
      args.push("--no-write-subs"); // Don't create separate subtitle files
      
      // Progress and error handling
      args.push("--newline"); // Each progress update on new line
      args.push("--no-warnings"); // Reduce noise
      args.push("--ignore-errors"); // Continue on errors for playlists
      
      // Add the URL
      args.push(sanitizedUrl);
      
      // Validate arguments for security
      const finalArgValidation = validateCommandArgs(args);
      if (!finalArgValidation.isValid || !finalArgValidation.sanitizedArgs) {
        throw new Error(`Invalid command arguments: ${finalArgValidation.errors?.join(", ")}`);
      }
      
      console.log("✅ Command arguments validated");
      console.log("🚀 Starting yt-dlp process...");
      console.log("📋 Full command:", ytDlpPath, finalArgValidation.sanitizedArgs!.join(" "));
      
      console.log("🎵 Using yt-dlp metadata parsing for album names");
      
      // Execute download with enhanced process management for background persistence
      const downloadProcess = spawn(ytDlpPath, finalArgValidation.sanitizedArgs!, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false, // Keep attached to parent for proper cleanup
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });
      
      let currentProgress: DownloadProgress = { elapsedTime: "0:00" };
      
      // Update elapsed time periodically
      const timeInterval = setInterval(() => {
        currentProgress.elapsedTime = calculateElapsedTime(startTime);
        updateOperationState(operationId, { 
          progress: { ...currentProgress }
        });
      }, 1000);
      
      // Process stdout for progress updates
      downloadProcess.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          console.log("📊 yt-dlp output:", line);
          
          // Parse progress information
          const progressUpdate = parseProgress(line);
          if (Object.keys(progressUpdate).length > 0) {
            currentProgress = { ...currentProgress, ...progressUpdate };
            updateOperationState(operationId, { 
              progress: { ...currentProgress }
            });
          }
          
          // Extract track info from JSON output
          if (line.includes('"title"') && line.includes('"uploader"')) {
            try {
              const jsonMatch = line.match(/\{.*\}/);
              if (jsonMatch) {
                const info = JSON.parse(jsonMatch[0]) as TrackInfo;
                trackInfo = info;
                updateOperationState(operationId, { trackInfo });
              }
            } catch (e) {
              // Ignore JSON parsing errors
            }
          }
          
          // Track completed downloads
          if (line.includes('[download] 100%') || line.includes('has already been downloaded')) {
            const fileMatch = line.match(/\[download\]\s+(.+?)\s+has already been downloaded/) || 
                            line.match(/\[ffmpeg\]\s+Destination:\s+(.+)/);
            if (fileMatch) {
              const filePath = fileMatch[1].trim();
              if (!downloadedFiles.includes(filePath)) {
                downloadedFiles.push(filePath);
                updateOperationState(operationId, { downloadedFiles: [...downloadedFiles] });
              }
            }
          }
        }
      });
      
      // Process stderr for errors
      downloadProcess.stderr?.on('data', (data: Buffer) => {
        const errorText = data.toString();
        console.error("❌ yt-dlp error:", errorText);
        
        // Only update error state for critical errors, not warnings
        if (errorText.includes('ERROR:') && !errorText.includes('WARNING:')) {
          updateOperationState(operationId, { 
            error: `Download error: ${errorText.slice(0, 200)}...`
          });
        }
      });
      
      // Handle process completion
      downloadProcess.on('close', async (code) => {
        clearInterval(timeInterval);
        
        console.log(`🏁 yt-dlp process finished with code: ${code}`);
        
        if (code === 0 || downloadedFiles.length > 0) {
          // Success - even if some tracks failed in a playlist
          const finalElapsedTime = calculateElapsedTime(startTime);
          
          updateOperationState(operationId, {
            isActive: false,
            isCompleted: true,
            progress: { 
              ...currentProgress, 
              percentage: 100,
              elapsedTime: finalElapsedTime
            },
            downloadedFiles
          });
          
          // Show success toast
          const fileCount = downloadedFiles.length;
          const message = isPlaylist 
            ? `✅ Downloaded ${fileCount} track${fileCount !== 1 ? 's' : ''} in ${finalElapsedTime}`
            : `✅ Downloaded track in ${finalElapsedTime}`;
          
          await showToast({
            style: Toast.Style.Success,
            title: "Download Complete",
            message
          });
          
          // Open in Apple Music if enabled
          if (settings.openInAppleMusic && downloadedFiles.length > 0) {
            await openInAppleMusic(downloadedFiles);
          }
          
        } else {
          // Error
          const errorMessage = `Download failed with exit code ${code}`;
          updateOperationState(operationId, {
            isActive: false,
            error: errorMessage
          });
          
          await showToast({
            style: Toast.Style.Failure,
            title: "Download Failed",
            message: errorMessage
          });
        }
      });
      
      // Handle process errors
      downloadProcess.on('error', async (error) => {
        clearInterval(timeInterval);
        console.error("💥 Process error:", error);
        
        const errorMessage = `Process error: ${error.message}`;
        updateOperationState(operationId, {
          isActive: false,
          error: errorMessage
        });
        
        await showToast({
          style: Toast.Style.Failure,
          title: "Download Error",
          message: errorMessage
        });
      });
      
    } catch (error) {
      console.error("💥 Download execution error:", error);
      
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      updateOperationState(operationId, {
        isActive: false,
        error: errorMessage
      });
      
      await showToast({
        style: Toast.Style.Failure,
        title: "Download Error",
        message: errorMessage
      });
    }
  };

  // Handle download initiation
  const handleDownload = async () => {
    if (!url.trim()) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Error",
        message: "Please enter a SoundCloud URL"
      });
      return;
    }
    
    if (!isValidSoundCloudUrl(url)) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Invalid URL",
        message: "Please enter a valid SoundCloud URL"
      });
      return;
    }
    
    setIsLoading(true);
    
    try {
      // Apply performance optimizations
      optimizePerformance();
      
      // Validate and sanitize the URL
      const urlValidation = validateCommandArgs([url]);
      if (!urlValidation.isValid || !urlValidation.sanitizedArgs?.[0]) {
        throw new Error("Invalid URL format");
      }
      
      const sanitizedUrl = urlValidation.sanitizedArgs[0];
      const isPlaylist = isPlaylistUrl(sanitizedUrl);
      
      // Validate and sanitize the download path
      const pathValidation = validateCommandArgs([settings.downloadPath]);
      if (!pathValidation.isValid || !pathValidation.sanitizedArgs?.[0]) {
        throw new Error("Invalid download path");
      }
      
      const safePath = pathValidation.sanitizedArgs[0];
      
      // Generate operation ID and start background download
      const operationId = generateOperationId();
      setCurrentOperationId(operationId);
      
      // Show initial toast
      await showToast({
        style: Toast.Style.Animated,
        title: isPlaylist ? "Starting Playlist Download" : "Starting Download",
        message: "Initializing..."
      });
      
      // Start background download (non-blocking)
      executeBackgroundDownload(operationId, sanitizedUrl, safePath, isPlaylist);
      
      // Navigate to progress view
      push(<DownloadProgress operationId={operationId} />);
      
    } catch (error) {
      console.error("💥 Download initiation error:", error);
      
      await showToast({
        style: Toast.Style.Failure,
        title: "Download Error",
        message: error instanceof Error ? error.message : "Failed to start download"
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Render main form
  return (
    <Form
      actions={
        <ActionPanel>
          <Action
            title="Download"
            icon={Icon.Download}
            onAction={handleDownload}
            shortcut={{ modifiers: ["cmd"], key: "enter" }}
          />
          <Action
            title="Settings"
            icon={Icon.Gear}
            onAction={() => push(<SettingsView settings={settings} onSettingsChange={setSettings} />)}
            shortcut={{ modifiers: ["cmd"], key: "," }}
          />
        </ActionPanel>
      }
      isLoading={isLoading}
    >
      <Form.TextField
        id="url"
        title="SoundCloud URL"
        placeholder="https://soundcloud.com/artist/track-name"
        value={url}
        onChange={setUrl}
        info="Enter a SoundCloud track or playlist URL"
      />
      
      <Form.Separator />
      
      <Form.Description
        title="Quality"
        text={QUALITY_PRESETS[settings.quality].name}
      />
      
      <Form.Description
        title="Download Path"
        text={settings.downloadPath}
      />
      
      <Form.Description
        title="Apple Music"
        text={settings.openInAppleMusic ? "Auto-open after download" : "Manual import"}
      />
    </Form>
  );
}

// Progress view component
function DownloadProgress({ operationId }: { operationId: string }) {
  const [operationState, setOperationState] = useState<OperationState>({
    isActive: false,
    progress: {},
    trackInfo: null,
    error: null,
    isCompleted: false,
    downloadedFiles: []
  });
  
  const isMountedRef = useRef(true);
  const { pop } = useNavigation();

  // Subscribe to operation updates
  useEffect(() => {
    const unsubscribe = subscribeToOperation(operationId, (state) => {
      if (isMountedRef.current) {
        setOperationState(state);
      }
    });
    
    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, [operationId]);

  // Generate progress content
  const generateProgressContent = (): string => {
    const { progress, trackInfo, error, isCompleted, isActive, downloadedFiles } = operationState;
    
    let content = "# Download Progress\n\n";
    
    if (error) {
      content += `## ❌ Error\n\n${error}\n\n`;
    } else if (isCompleted) {
      content += `## ✅ Download Complete\n\n`;
      content += `**Files Downloaded:** ${downloadedFiles.length}\n\n`;
      if (progress.elapsedTime) {
        content += `**Total Time:** ${progress.elapsedTime}\n\n`;
      }
    } else if (isActive) {
      content += `## 🔄 Downloading...\n\n`;
      
      // Progress information
      if (progress.currentTrack && progress.totalTracks) {
        content += `**Track:** ${progress.currentTrack} of ${progress.totalTracks}\n\n`;
        const playlistPercentage = Math.round((progress.currentTrack / progress.totalTracks) * 100);
        content += `**Playlist Progress:** ${playlistPercentage}%\n\n`;
      }
      
      if (progress.trackTitle) {
        content += `**Current Track:** ${progress.trackTitle}\n\n`;
      }
      
      if (progress.percentage !== undefined) {
        content += `**Download:** ${progress.percentage.toFixed(1)}%\n\n`;
      }
      
      if (progress.speed) {
        content += `**Speed:** ${progress.speed}\n\n`;
      }
      
      if (progress.eta) {
        content += `**ETA:** ${progress.eta}\n\n`;
      }
      
      if (progress.elapsedTime) {
        content += `**Elapsed:** ${progress.elapsedTime}\n\n`;
      }
    } else {
      content += `## ⏳ Initializing...\n\n`;
    }
    
    // Track information
    if (trackInfo) {
      content += `## 🎵 Track Information\n\n`;
      if (trackInfo.title) content += `**Title:** ${trackInfo.title}\n\n`;
      if (trackInfo.uploader) content += `**Artist:** ${trackInfo.uploader}\n\n`;
      if (trackInfo.duration) {
        const minutes = Math.floor(trackInfo.duration / 60);
        const seconds = trackInfo.duration % 60;
        content += `**Duration:** ${minutes}:${seconds.toString().padStart(2, '0')}\n\n`;
      }
      if (trackInfo.view_count) content += `**Views:** ${trackInfo.view_count.toLocaleString()}\n\n`;
      if (trackInfo.like_count) content += `**Likes:** ${trackInfo.like_count.toLocaleString()}\n\n`;
    }
    
    return content;
  };

  return (
    <Detail
      markdown={generateProgressContent()}
      actions={
        <ActionPanel>
          <Action
            title="Back"
            icon={Icon.ArrowLeft}
            onAction={pop}
            shortcut={{ modifiers: ["cmd"], key: "arrowLeft" }}
          />
          {operationState.isCompleted && (
            <Action
              title="New Download"
              icon={Icon.Plus}
              onAction={pop}
              shortcut={{ modifiers: ["cmd"], key: "n" }}
            />
          )}
        </ActionPanel>
      }
    />
  );
}

// Settings view component
function SettingsView({ 
  settings, 
  onSettingsChange 
}: { 
  settings: typeof DEFAULT_SETTINGS;
  onSettingsChange: (settings: typeof DEFAULT_SETTINGS) => void;
}) {
  const { pop } = useNavigation();
  
  const handleSubmit = (values: any) => {
    onSettingsChange({
      quality: values.quality,
      downloadPath: values.downloadPath,
      openInAppleMusic: values.openInAppleMusic,
      embedThumbnail: values.embedThumbnail,
      addMetadata: values.addMetadata
    });
    pop();
  };

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Settings"
            icon={Icon.Check}
            onSubmit={handleSubmit}
          />
          <Action
            title="Cancel"
            icon={Icon.XMarkCircle}
            onAction={pop}
            shortcut={{ modifiers: ["cmd"], key: "escape" }}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="quality"
        title="Audio Quality"
        defaultValue={settings.quality}
        info="Higher quality = larger file size"
      >
        {Object.entries(QUALITY_PRESETS).map(([key, preset]) => (
          <Form.Dropdown.Item
            key={key}
            value={key}
            title={preset.name}
          />
        ))}
      </Form.Dropdown>
      
      <Form.TextField
        id="downloadPath"
        title="Download Path"
        defaultValue={settings.downloadPath}
        placeholder={join(homedir(), "Downloads", "SoundCloud")}
        info="Where to save downloaded files"
      />
      
      <Form.Separator />
      
      <Form.Checkbox
        id="openInAppleMusic"
        title="Apple Music Integration"
        label="Auto-open in Apple Music after download"
        defaultValue={settings.openInAppleMusic}
        info="Automatically import and open downloaded tracks in Apple Music"
      />
      
      <Form.Checkbox
        id="embedThumbnail"
        title="Embed Album Art"
        label="Embed cover art into MP3 files"
        defaultValue={settings.embedThumbnail}
        info="Includes album artwork directly in the audio file"
      />
      
      <Form.Checkbox
        id="addMetadata"
        title="Add Metadata"
        label="Include track information (title, artist, etc.)"
        defaultValue={settings.addMetadata}
        info="Adds track metadata for better organization"
      />
    </Form>
  );
}