/**
 * Security module
 *
 * Provides SSRF protection, external-content safety handling, and user-input detection.
 *
 * @module security
 */

// External content wrapping
export {
  // Constants
  BOUNDARY_START,
  BOUNDARY_END,

  // Main functions
  wrapExternalContent,
  wrapExternalContentWithResult,
  unwrapExternalContent,
  isWrappedContent,

  // Utility functions
  sanitizeMarkers,
  detectSuspiciousPatterns,

  // Types
  type ContentSource,
  type WrapOptions,
  type WrapResult,
} from './external-content.js';

// User-input safety detection
export {
  // Main functions
  detectSensitiveRequest,
  formatGuardLog,

  // Types
  type ThreatLevel,
  type InputGuardResult,
} from './input-guard.js';

// Memory/skill write scanning (persistent-injection protection)
export {
  scanMemoryWrite,
  stripFenceTags,
  formatScanLog,
  type ContentScanResult,
} from './content-scan.js';
