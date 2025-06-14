import { z } from "zod";
import path from "path";
import os from "os";

// Enhanced URL validation schema for SoundCloud
export const SoundCloudUrlSchema = z
  .string()
  .url("Invalid URL format")
  .refine((url: string) => {
    try {
      const parsed = new URL(url);
      // Support multiple SoundCloud domains and formats
      const validDomains = [
        "soundcloud.com",
        "www.soundcloud.com",
        "m.soundcloud.com",
        "mobile.soundcloud.com",
        "on.soundcloud.com",
      ];
      return validDomains.includes(parsed.hostname);
    } catch {
      return false;
    }
  }, "Must be a valid SoundCloud URL");

// Path validation schema
export const OutputPathSchema = z
  .string()
  .min(1, "Path cannot be empty")
  .refine((inputPath: string) => {
    try {
      const resolved = path.resolve(inputPath);
      const homeDir = os.homedir();
      // Ensure path is within user's home directory or common safe directories
      const safePaths = [
        homeDir,
        path.join(homeDir, "Downloads"),
        path.join(homeDir, "Documents"),
        path.join(homeDir, "Desktop"),
        path.join(homeDir, "Music"),
      ];

      return safePaths.some((safePath) => resolved.startsWith(safePath));
    } catch {
      return false;
    }
  }, "Path must be within safe directories");

// Audio quality validation
export const AudioQualitySchema = z.enum(["0", "2", "5", "320K"], {
  errorMap: () => ({ message: "Invalid audio quality setting" }),
});

// Sanitize URL to prevent command injection
export const sanitizeUrl = (url: string): string => {
  // Remove any shell metacharacters that could be used for injection
  // FIXED: Removed <> characters to preserve yt-dlp template syntax like %(title)s.%(ext)s
  return url.replace(/[;&|`$(){}[\]\\]/g, "");
};

// Normalize SoundCloud URL to standard format
export const normalizeSoundCloudUrl = (url: string): string => {
  try {
    const parsed = new URL(url);

    // Convert mobile/shortened URLs to standard format
    if (parsed.hostname === "m.soundcloud.com" || parsed.hostname === "mobile.soundcloud.com") {
      parsed.hostname = "soundcloud.com";
    }

    // Handle on.soundcloud.com shortened URLs
    if (parsed.hostname === "on.soundcloud.com") {
      // These are redirect URLs, keep as-is for yt-dlp to handle
      return parsed.toString();
    }

    // Remove tracking parameters but keep essential ones
    const allowedParams = ["t", "in", "si", "utm_source", "utm_medium", "utm_campaign"];
    const searchParams = new URLSearchParams();

    for (const [key, value] of parsed.searchParams.entries()) {
      if (allowedParams.includes(key)) {
        searchParams.set(key, value);
      }
    }

    parsed.search = searchParams.toString();

    return parsed.toString();
  } catch {
    return url; // Return original if parsing fails
  }
};

// Enhanced SoundCloud URL pattern detection
export const detectSoundCloudUrlType = (url: string): { type: string; isValid: boolean } => {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;

    // Shortened URL patterns (on.soundcloud.com) - check this first
    if (parsed.hostname === "on.soundcloud.com") {
      return { type: "shortened", isValid: true };
    }

    // Discover/explore URLs - check before user patterns
    if (pathname.startsWith("/discover") || pathname.startsWith("/explore")) {
      return { type: "discover", isValid: false };
    }

    // Search URLs
    if (pathname.startsWith("/search")) {
      return { type: "search", isValid: false };
    }

    // Playlist URLs (sets) - check before individual tracks
    if (pathname.includes("/sets/")) {
      return { type: "playlist", isValid: true };
    }

    // Album URLs (also playlists)
    if (pathname.includes("/albums/")) {
      return { type: "album", isValid: true };
    }

    // Individual track URLs - must have at least two path segments
    const pathSegments = pathname.split("/").filter((segment) => segment.length > 0);
    if (pathSegments.length >= 2) {
      // Check if it's a user profile (only one segment after username)
      if (pathSegments.length === 1) {
        return { type: "user", isValid: false };
      }

      // Valid track URL pattern: /username/track-name
      return { type: "track", isValid: true };
    }

    // User profile URLs (just username)
    if (pathSegments.length === 1) {
      return { type: "user", isValid: false };
    }

    // Root or other invalid patterns
    return { type: "unknown", isValid: false };
  } catch {
    return { type: "invalid", isValid: false };
  }
};

// Validate and sanitize file path
export const validateAndSanitizePath = (inputPath: string): string => {
  try {
    // Validate with schema
    const validatedPath = OutputPathSchema.parse(inputPath);

    // Resolve and normalize the path
    const resolved = path.resolve(validatedPath);

    // Additional security check
    const homeDir = os.homedir();
    if (!resolved.startsWith(homeDir)) {
      throw new Error("Path must be within user directory");
    }

    return resolved;
  } catch (error: unknown) {
    throw new Error(`Invalid path: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
};

// Enhanced SoundCloud URL validation with comprehensive format support
export const validateSoundCloudUrl = (
  url: string,
): { isValid: boolean; error?: string; sanitizedUrl?: string; urlType?: string } => {
  try {
    // Basic format validation
    const validatedUrl = SoundCloudUrlSchema.parse(url);

    // Detect URL type
    const { type, isValid: typeValid } = detectSoundCloudUrlType(validatedUrl);

    if (!typeValid) {
      const errorMessages = {
        discover: "Discover pages are not downloadable. Please use a specific track or playlist URL.",
        search: "Search pages are not downloadable. Please use a specific track or playlist URL.",
        user: "User profile URLs are not directly downloadable. Please use a specific track or playlist URL.",
        unknown: "This SoundCloud URL format is not supported for downloading.",
        invalid: "Invalid SoundCloud URL format.",
      };

      return {
        isValid: false,
        error: errorMessages[type as keyof typeof errorMessages] || "Invalid SoundCloud URL format.",
        urlType: type,
      };
    }

    // Normalize and sanitize the URL
    const normalizedUrl = normalizeSoundCloudUrl(validatedUrl);
    const sanitizedUrl = sanitizeUrl(normalizedUrl);

    return {
      isValid: true,
      sanitizedUrl,
      urlType: type,
    };
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return {
        isValid: false,
        error: error.errors[0]?.message || "Invalid URL format",
      };
    }

    return {
      isValid: false,
      error: error instanceof Error ? error.message : "Unknown validation error",
    };
  }
};

// Audio quality validation
export const validateAudioQuality = (quality: string): { isValid: boolean; error?: string } => {
  try {
    AudioQualitySchema.parse(quality);
    return { isValid: true };
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return {
        isValid: false,
        error: error.errors[0]?.message || "Invalid audio quality",
      };
    }
    return { isValid: false, error: "Unknown validation error" };
  }
};

// Escape shell arguments to prevent injection
export const escapeShellArg = (arg: string): string => {
  // Use single quotes and escape any single quotes in the argument
  return `'${arg.replace(/'/g, "'\"'\"'")}'`;
};

// Comprehensive command argument validation
export const validateCommandArgs = (args: string[]): { isValid: boolean; errors?: string[]; sanitizedArgs?: string[] } => {
  const errors: string[] = [];
  const sanitizedArgs: string[] = [];

  for (const arg of args) {
    // Check for null or undefined
    if (arg == null) {
      errors.push("Argument cannot be null or undefined");
      continue;
    }

    // Convert to string if not already
    const stringArg = String(arg);

    // Check for excessively long arguments
    if (stringArg.length > 2000) {
      errors.push(`Argument too long: ${stringArg.length} characters`);
      continue;
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /\$\(/,     // Command substitution
      /`[^`]*`/,  // Backtick command substitution
      /&&/,       // Command chaining
      /\|\|/,     // Command chaining
      /;/,        // Command separator
      />/,        // Redirection
      /</,        // Redirection
    ];

    const hasDangerousPattern = dangerousPatterns.some(pattern => pattern.test(stringArg));
    if (hasDangerousPattern) {
      errors.push(`Potentially dangerous pattern in argument: ${stringArg}`);
      continue;
    }

    // Sanitize the argument
    const sanitized = stringArg
      .replace(/[\x00-\x1f\x7f-\x9f]/g, '') // Remove control characters
      .trim();

    if (sanitized.length === 0 && stringArg.length > 0) {
      errors.push("Argument became empty after sanitization");
      continue;
    }

    sanitizedArgs.push(sanitized);
  }

  return {
    isValid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    sanitizedArgs: errors.length === 0 ? sanitizedArgs : undefined,
  };
};

// Rate limiting utility
export class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number = 10, windowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  canMakeRequest(): boolean {
    const now = Date.now();
    
    // Remove old requests outside the window
    this.requests = this.requests.filter(timestamp => now - timestamp < this.windowMs);
    
    // Check if we can make a new request
    if (this.requests.length < this.maxRequests) {
      this.requests.push(now);
      return true;
    }
    
    return false;
  }

  getTimeUntilNextRequest(): number {
    if (this.requests.length < this.maxRequests) {
      return 0;
    }
    
    const oldestRequest = Math.min(...this.requests);
    const timeUntilExpiry = this.windowMs - (Date.now() - oldestRequest);
    return Math.max(0, timeUntilExpiry);
  }
}