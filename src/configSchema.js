// Schema for enshrouded_server.json, built from Keen's own Zendesk docs
// (Dedicated Server Configuration / Server Gameplay Settings / Save Game
// Management) cross-checked against gameserverkings.com and respawnhost.com.
//
// IMPORTANT CAVEATS (don't build on these without re-checking):
//  - The file does NOT exist until enshrouded_server.exe has been run once.
//    It is generated on first launch, not shipped with the install.
//  - gameSettings is entirely ignored by the server unless
//    gameSettingsPreset is exactly "Custom".
//  - Duration fields inside gameSettings are in NANOSECONDS, not seconds.
//  - Some third-party tools reference top-level "gamePort", "bindIP" and
//    "password" fields. These could NOT be confirmed against Keen's own
//    docs or the two independent hosting-provider references used here, so
//    they are deliberately left out of the structured editor. The "Raw
//    JSON" tab in the UI can still edit them (or anything else) directly —
//    use it, and compare against a real generated config file, before
//    trusting fields not listed below.
//  - The UDP game-traffic port is not believed to be independently
//    configurable in JSON; it's derived as (queryPort - 1). Only queryPort
//    is exposed here.

const NANOSECONDS_PER_MINUTE = 60 * 1000000000;

const TOP_LEVEL_DEFAULTS = {
  name: 'Enshrouded Server',
  saveDirectory: './savegame',
  logDirectory: './logs',
  ip: '0.0.0.0',
  queryPort: 15637,
  slotCount: 16,
  tags: [],
  voiceChatMode: 'Proximity',
  enableVoiceChat: false,
  enableTextChat: false,
  gameSettingsPreset: 'Default',
  userGroups: [
    { name: 'Admin', password: 'changeme-admin', canKickBan: true, canAccessInventories: true, canEditBase: true, canExtendBase: true, reservedSlots: 1 },
    { name: 'Friend', password: 'changeme-friend', canKickBan: false, canAccessInventories: true, canEditBase: true, canExtendBase: true, reservedSlots: 0 },
    { name: 'Guest', password: 'changeme-guest', canKickBan: false, canAccessInventories: false, canEditBase: false, canExtendBase: false, reservedSlots: 0 }
  ],
  bannedAccounts: []
};

// field: [type, default, min, max, options, unit]
// unit: 'factor' | 'nanoseconds-duration' | null
const GAME_SETTINGS_FIELDS = [
  ['playerHealthFactor', 'float', 1, 0.25, 4],
  ['playerManaFactor', 'float', 1, 0.25, 4],
  ['playerStaminaFactor', 'float', 1, 0.25, 4],
  ['playerBodyHeatFactor', 'float', 1, 0.5, 2],
  ['playerDivingTimeFactor', 'float', 1, 0.5, 2],
  ['enableDurability', 'bool', true],
  ['enableStarvingDebuff', 'bool', false],
  ['foodBuffDurationFactor', 'float', 1, 0.5, 2],
  ['fromHungerToStarving', 'nanoseconds-duration', 600000000000, 120000000000, 3600000000000],
  ['shroudTimeFactor', 'float', 1, 0.5, 2],
  ['enableGliderTurbulences', 'bool', true],
  ['weatherFrequency', 'enum', 'Normal', null, null, ['Disabled', 'Rare', 'Normal', 'Often']],
  ['randomSpawnerAmount', 'enum', 'Normal', null, null, ['Few', 'Normal', 'Many', 'Extreme']],
  ['fishingDifficulty', 'enum', 'Normal', null, null, ['VeryEasy', 'Easy', 'Normal', 'Hard', 'VeryHard']],
  ['miningDamageFactor', 'float', 1, 0.5, 2],
  ['plantGrowthSpeedFactor', 'float', 1, 0.25, 2],
  ['resourceDropStackAmountFactor', 'float', 1, 0.25, 2],
  ['factoryProductionSpeedFactor', 'float', 1, 0.25, 2],
  ['perkUpgradeRecyclingFactor', 'float', 0.5, 0, 1],
  ['perkCostFactor', 'float', 1, 0.25, 2],
  ['experienceCombatFactor', 'float', 1, 0.25, 2],
  ['experienceMiningFactor', 'float', 1, 0, 2],
  ['experienceExplorationQuestsFactor', 'float', 1, 0.25, 2],
  ['aggroPoolAmount', 'enum', 'Normal', null, null, ['Few', 'Normal', 'Many', 'Extreme']],
  ['enemyDamageFactor', 'float', 1, 0.25, 5],
  ['enemyHealthFactor', 'float', 1, 0.25, 4],
  ['enemyStaminaFactor', 'float', 1, 0.5, 2],
  ['enemyPerceptionRangeFactor', 'float', 1, 0.5, 2],
  ['bossDamageFactor', 'float', 1, 0.2, 5],
  ['bossHealthFactor', 'float', 1, 0.2, 5],
  ['threatBonus', 'float', 1, 0.25, 4],
  ['pacifyAllEnemies', 'bool', false],
  ['tamingStartleRepercussion', 'enum', 'LoseSomeProgress', null, null, ['KeepProgress', 'LoseSomeProgress', 'LoseAllProgress']],
  ['dayTimeDuration', 'nanoseconds-duration', 1800000000000, 120000000000, 3600000000000],
  ['nightTimeDuration', 'nanoseconds-duration', 720000000000, 120000000000, 3600000000000],
  ['curseModifier', 'enum', 'Normal', null, null, ['Easy', 'Normal', 'Hard']],
  ['tombstoneMode', 'enum', 'AddBackpackMaterials', null, null, ['AddBackpackMaterials', 'Everything', 'NoTombstone']]
].map(([key, type, def, min, max, options]) => ({ key, type, default: def, min, max, options: options || null }));

function defaultGameSettings() {
  const out = {};
  GAME_SETTINGS_FIELDS.forEach((f) => {
    out[f.key] = f.default;
  });
  return out;
}

function defaultConfig() {
  return {
    ...JSON.parse(JSON.stringify(TOP_LEVEL_DEFAULTS)),
    gameSettings: defaultGameSettings()
  };
}

function nanosToMinutes(n) {
  return Math.round((n / NANOSECONDS_PER_MINUTE) * 100) / 100;
}

function minutesToNanos(m) {
  return Math.round(m * NANOSECONDS_PER_MINUTE);
}

module.exports = {
  TOP_LEVEL_DEFAULTS,
  GAME_SETTINGS_FIELDS,
  defaultConfig,
  defaultGameSettings,
  nanosToMinutes,
  minutesToNanos,
  NANOSECONDS_PER_MINUTE
};
