/**
 * Configuration module.
 *
 * Read/write and validation for JSON5 config files.
 *
 * Features:
 * - JSON5 format support
 * - Environment-variable substitution (`${VAR}` and `${VAR:-default}`)
 * - Config validation
 * - Defaults application
 * - Atomic write with backups
 */

// Types
export * from './types.js';

// Validation
export {
  validateConfig,
  isValidConfig,
  getConfigErrors,
} from './validation.js';

// Environment variable substitution
export {
  MissingEnvVarError,
  substituteEnvVars,
  resolveConfigEnvVars,
  collectEnvVarRefs,
  checkEnvVarsSet,
  createEnvResolver,
  safeSubstituteEnvVars,
  type EnvSubstitutionOptions,
} from './env-substitution.js';

// Defaults
export {
  applyConfigDefaults,
  applySessionDefaults,
  applyQueueDefaults,
  applyTypingDefaults,
  applyBlockReplyDefaults,
  applyErrorRecoveryDefaults,
  applyAgentDefaults,
  getEffectiveSessionConfig,
  getEffectiveQueueConfig,
  getEffectiveTypingConfig,
  getEffectiveBlockReplyConfig,
  getEffectiveErrorRecoveryConfig,
} from './defaults.js';

// IO
export {
  createConfigIO,
  parseConfigJson5,
  resolveDefaultConfigPath,
  resolveConfigCandidates,
  loadConfig,
  loadConfigAsync,
  readConfigFileSnapshot,
  writeConfigFile,
  type ConfigIO,
  type ConfigIoDeps,
  type ParseJson5Result,
} from './io.js';
