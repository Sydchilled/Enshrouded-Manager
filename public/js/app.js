(() => {
  const NANOS_PER_MINUTE = 60 * 1000000000;

  let gameSettingsFields = [];
  let currentConfig = null;

  // ---------- tab switching ----------
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'backups') loadBackups();
      if (btn.dataset.tab === 'logs') loadLogLists();
      if (btn.dataset.tab === 'setup') loadSteamCmdStatus();
      if (btn.dataset.tab === 'config') loadConfig();
    });
  });

  document.querySelectorAll('.config-subtab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.config-subtab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.config-subpanel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('configsub-' + btn.dataset.subtab).classList.add('active');
    });
  });

  // ---------- helpers ----------
  async function api(path, opts) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  function formatUptime(ms) {
    if (!ms) return '—';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${m}m ${sec}s`;
  }

  function appendConsoleLine(el, text) {
    el.textContent += text + '\n';
    el.scrollTop = el.scrollHeight;
  }

  // ---------- status / lifecycle ----------
  function applyStatus(status) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    const lState = document.getElementById('lifecycleState');
    const lPid = document.getElementById('lifecyclePid');
    const lUptime = document.getElementById('lifecycleUptime');

    if (status.running) {
      dot.className = 'dot on';
      text.textContent = 'Running';
      lState.textContent = 'Running';
    } else {
      dot.className = 'dot off';
      text.textContent = 'Stopped';
      lState.textContent = 'Stopped';
    }
    lPid.textContent = status.pid || '—';
    lUptime.textContent = formatUptime(status.uptimeMs);

    document.getElementById('btnStart').disabled = status.running;
    document.getElementById('btnStop').disabled = !status.running;
    document.getElementById('btnRestart').disabled = !status.running;
  }

  async function refreshStatus() {
    try {
      const status = await api('/api/server/status');
      applyStatus(status);
      refreshPlayersOnline(status);
    } catch (_) { /* ignore */ }
  }

  async function refreshPlayersOnline(status) {
    const el = document.getElementById('infoPlayersOnline');
    if (!el) return;
    if (!status.running) {
      el.textContent = '—';
      return;
    }
    try {
      const result = await api('/api/server/players');
      if (result.available) {
        el.textContent = `${result.players} / ${result.maxPlayers}`;
      } else if (result.reason === 'no-query-port') {
        el.textContent = 'Unknown (no query port set)';
      } else {
        el.textContent = 'Unknown';
      }
    } catch (_) {
      el.textContent = 'Unknown';
    }
  }

  document.getElementById('btnStart').addEventListener('click', async () => {
    try {
      await api('/api/server/start', { method: 'POST' });
      refreshStatus();
    } catch (err) { alert(err.message); }
  });

  document.getElementById('btnStop').addEventListener('click', async () => {
    if (!confirm('This is a hard stop (no confirmed graceful shutdown exists for Enshrouded). Progress since the ' +
      'last autosave (~10 min interval) may be lost. Continue?')) return;
    try {
      await api('/api/server/stop', { method: 'POST' });
      refreshStatus();
    } catch (err) { alert(err.message); }
  });

  document.getElementById('btnRestart').addEventListener('click', async () => {
    if (!confirm('Restart will hard-stop then start the server again. Continue?')) return;
    try {
      await api('/api/server/restart', { method: 'POST' });
      refreshStatus();
    } catch (err) { alert(err.message); }
  });

  // ---------- websocket ----------
  function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    const consoleEl = document.getElementById('console');
    ws.addEventListener('message', (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch (_) { return; }
      if (data.channel === 'console') {
        appendConsoleLine(consoleEl, data.message);
      } else if (data.channel === 'status') {
        applyStatus(data.message);
      } else if (data.channel === 'steamcmd') {
        appendConsoleLine(document.getElementById('steamcmdConsole'), data.message);
      } else if (data.channel === 'backup') {
        // Surface backup events in the console too, so they're not silent.
        appendConsoleLine(consoleEl, '[backup] ' + data.message);
      } else if (data.channel === 'quickstart') {
        appendConsoleLine(document.getElementById('quickstartLog'), data.message);
      } else if (data.channel === 'quickstart-done') {
        const btn = document.getElementById('btnQuickstart');
        btn.disabled = false;
        btn.textContent = 'Install & Start My Server';
        const resultEl = document.getElementById('quickstartResult');
        if (data.message.ok) {
          resultEl.innerHTML = '<div class="box tip"><strong class="label">All set!</strong> Your server is starting up. Check the Dashboard tab in a minute to confirm it says Running.</div>';
        } else {
          resultEl.innerHTML = `<div class="box warn"><strong class="label">Something went wrong</strong> ${data.message.error}</div>`;
        }
      }
    });
    ws.addEventListener('close', () => setTimeout(connectWs, 2000));
  }

  // ---------- quick setup ----------
  document.getElementById('btnQuickstart').addEventListener('click', async () => {
    const btn = document.getElementById('btnQuickstart');
    document.getElementById('quickstartLog').textContent = '';
    document.getElementById('quickstartResult').innerHTML = '';
    btn.disabled = true;
    btn.textContent = 'Working…';
    try {
      await api('/api/quickstart', {
        method: 'POST',
        body: JSON.stringify({
          serverName: document.getElementById('qsServerName').value,
          password: document.getElementById('qsPassword').value,
          slotCount: Number(document.getElementById('qsSlotCount').value),
          preset: document.getElementById('qsPreset').value
        })
      });
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Install & Start My Server';
      alert(err.message);
    }
  });

  // ---------- settings / setup ----------
  async function loadSettings() {
    const s = await api('/api/settings');
    document.getElementById('settingInstallDir').value = s.installDir;
    document.getElementById('settingSteamCmdDir').value = s.steamCmdDir;
    document.getElementById('settingBackupDir').value = s.backupDir;
    document.getElementById('settingPanelPort').value = s.panelPort;
    document.getElementById('infoInstallDir').textContent = s.installDir;
    document.getElementById('backupEnabled').checked = !!s.backupsEnabled;
    document.getElementById('backupInterval').value = s.backupIntervalMinutes;
    document.getElementById('backupRetention').value = s.backupRetentionCount;
    return s;
  }

  // ---------- native folder Browse buttons ----------
  // Shared by the static Browse… buttons below and by the bat-import card's
  // dynamically-inserted "Browse for it…" button (see btnParseBat handler).
  async function nativeBrowse(initialDir) {
    try {
      const result = await api('/api/setup/browse-folder', {
        method: 'POST',
        body: JSON.stringify({ initialDir: initialDir || '' })
      });
      document.getElementById('browseUnsupportedHint').hidden = true;
      return result.path || null; // null = dialog was cancelled, or nothing chosen
    } catch (err) {
      document.getElementById('browseUnsupportedHint').hidden = false;
      alert(err.message);
      return undefined; // distinct from "cancelled" — the picker itself failed
    }
  }

  document.querySelectorAll('[data-browse-for]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const input = document.getElementById(btn.dataset.browseFor);
      if (!input) return;
      const originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Waiting for picker…';
      try {
        const picked = await nativeBrowse(input.value);
        if (picked) input.value = picked;
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });
  });

  document.getElementById('btnSaveSettings').addEventListener('click', async () => {
    try {
      await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          installDir: document.getElementById('settingInstallDir').value,
          steamCmdDir: document.getElementById('settingSteamCmdDir').value,
          backupDir: document.getElementById('settingBackupDir').value,
          panelPort: Number(document.getElementById('settingPanelPort').value)
        })
      });
      alert('Saved. (Panel port change needs a manual restart of the manager itself.)');
      loadSettings();
    } catch (err) { alert(err.message); }
  });

  // ---------- import an existing bare-bones install (.bat file + its enshrouded_server.json) ----------
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Actually reads enshrouded_server.exe / enshrouded_server.json off disk at
  // `dir` (via the backend, which runs on the same machine as the server)
  // and reports plainly whether the import succeeded or failed.
  async function doImport(dir, resultEl) {
    resultEl.hidden = false;
    if (!dir || !dir.trim()) {
      resultEl.className = 'banner warn';
      resultEl.textContent = 'Enter or detect an install folder first.';
      return;
    }
    resultEl.className = 'banner info';
    resultEl.textContent = 'Checking that folder…';
    try {
      const result = await api('/api/setup/import-existing', {
        method: 'POST',
        body: JSON.stringify({ installDir: dir })
      });
      resultEl.className = result.ok ? 'banner info' : 'banner warn';

      let html = `<div><strong>${result.ok ? '✓ Import successful' : '✗ Import failed'}</strong> — ${escapeHtml(result.message)}</div>`;
      if (result.ok && result.configFound && result.configSummary) {
        const c = result.configSummary;
        html += '<table style="margin-top:8px;"><tbody>' +
          `<tr><td>Server name</td><td><code>${escapeHtml(c.name || '')}</code></td></tr>` +
          `<tr><td>Query port</td><td><code>${escapeHtml(c.queryPort)}</code></td></tr>` +
          `<tr><td>Slots</td><td><code>${escapeHtml(c.slotCount)}</code></td></tr>` +
          `<tr><td>Save directory</td><td><code>${escapeHtml(c.saveDirectory || '')}</code></td></tr>` +
          `<tr><td>Gameplay preset</td><td><code>${escapeHtml(c.gameSettingsPreset || '')}</code></td></tr>` +
          '</tbody></table>';
      }
      resultEl.innerHTML = html;

      if (result.ok) {
        loadSettings();
        loadSteamCmdStatus();
        // Re-read enshrouded_server.json for the just-imported folder right
        // away, not just when the Config tab happens to be clicked next —
        // otherwise a tab already open (or the initial page-load fetch, made
        // before this folder was even set) keeps showing stale/default data.
        loadConfig();
      }
    } catch (err) {
      resultEl.className = 'banner warn';
      resultEl.textContent = err.message;
    }
  }

  const btnImportHere = document.getElementById('btnImportHere');
  if (btnImportHere) {
    btnImportHere.addEventListener('click', () => {
      doImport(document.getElementById('settingInstallDir').value, document.getElementById('pathsImportResult'));
    });
  }

  const batImportFile = document.getElementById('batImportFile');
  if (batImportFile) {
    batImportFile.addEventListener('change', () => {
      const file = batImportFile.files && batImportFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        document.getElementById('batImportText').value = String(reader.result || '');
      };
      reader.readAsText(file);
    });
  }

  const btnParseBat = document.getElementById('btnParseBat');
  if (btnParseBat) {
    btnParseBat.addEventListener('click', async () => {
      const resultEl = document.getElementById('batImportResult');
      const text = document.getElementById('batImportText').value;
      if (!text.trim()) {
        resultEl.hidden = false;
        resultEl.className = 'banner warn';
        resultEl.textContent = 'Paste your .bat file\'s contents (or pick the file) first.';
        return;
      }
      try {
        const result = await api('/api/setup/parse-bat', {
          method: 'POST',
          body: JSON.stringify({ text })
        });
        resultEl.hidden = false;
        resultEl.className = result.installDir ? 'banner info' : 'banner warn';

        let html = '';
        if (result.installDir) {
          html += `<div><strong>Detected install folder:</strong> <code>${escapeHtml(result.installDir)}</code>`;
          html += result.exeFoundAtPath
            ? ' <span style="color: var(--green, #3ec97a);">— enshrouded_server.exe found there ✓</span>'
            : '';
          html += '</div>';
        } else if (result.relativeHint) {
          html += `<div><strong>This .bat file's folder can't be read from pasted text</strong> — it only ever ` +
            `runs enshrouded_server.exe from a subfolder named <code>${escapeHtml(result.relativeHint)}</code> ` +
            'relative to itself, and a browser has no way to know where that .bat file actually sits on disk. ' +
            'Click below to browse to it directly instead.</div>';
        }
        if (result.warnings && result.warnings.length) {
          html += '<ul style="margin:8px 0 0 18px; padding:0;">' +
            result.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('') + '</ul>';
        }
        if (result.installDir) {
          html += '<div class="btn-row" style="margin-top:10px;">' +
            '<button class="btn btn-primary" id="btnImportDetectedDir">Import this folder</button></div>';
        } else if (result.relativeHint) {
          html += '<div class="btn-row" style="margin-top:10px;">' +
            '<button class="btn btn-primary" id="btnBrowseForRelative">Browse for it…</button></div>';
        }
        resultEl.innerHTML = html;

        const importBtn = document.getElementById('btnImportDetectedDir');
        if (importBtn) {
          importBtn.addEventListener('click', () => {
            document.getElementById('settingInstallDir').value = result.installDir;
            doImport(result.installDir, resultEl);
          });
        }

        const browseBtn = document.getElementById('btnBrowseForRelative');
        if (browseBtn) {
          browseBtn.addEventListener('click', async () => {
            const originalLabel = browseBtn.textContent;
            browseBtn.disabled = true;
            browseBtn.textContent = 'Waiting for picker…';
            const picked = await nativeBrowse(document.getElementById('settingInstallDir').value);
            browseBtn.disabled = false;
            browseBtn.textContent = originalLabel;
            if (picked) {
              document.getElementById('settingInstallDir').value = picked;
              await doImport(picked, resultEl);
            }
          });
        }
      } catch (err) {
        resultEl.hidden = false;
        resultEl.className = 'banner warn';
        resultEl.textContent = err.message;
      }
    });
  }

  async function loadSteamCmdStatus() {
    try {
      const s = await api('/api/steamcmd/status');
      document.getElementById('steamCmdInstalled').textContent = s.steamCmdInstalled ? 'Yes' : 'No';
      document.getElementById('serverExeInstalled').textContent = s.serverExeInstalled ? 'Yes' : 'No';
    } catch (_) { /* ignore */ }
  }

  document.getElementById('btnInstallSteamCmd').addEventListener('click', async () => {
    document.getElementById('steamcmdConsole').textContent = '';
    try {
      await api('/api/steamcmd/install', { method: 'POST' });
      loadSteamCmdStatus();
    } catch (err) { alert(err.message); }
  });

  document.getElementById('btnUpdateServer').addEventListener('click', async () => {
    document.getElementById('steamcmdConsole').textContent = '';
    try {
      await api('/api/steamcmd/update', { method: 'POST' });
      loadSteamCmdStatus();
      loadQuickInfo();
    } catch (err) { alert(err.message); }
  });

  // ---------- config editor ----------
  function renderGameplayFields(gameSettings) {
    const container = document.getElementById('gameplayFieldsContainer');
    container.innerHTML = '';
    gameSettingsFields.forEach((f) => {
      const wrap = document.createElement('label');
      wrap.dataset.key = f.key;
      const value = gameSettings ? gameSettings[f.key] : f.default;

      if (f.type === 'bool') {
        wrap.className = 'checkbox-label';
        wrap.innerHTML = `<input type="checkbox" data-field="${f.key}" data-type="bool" ${value ? 'checked' : ''}/> ${f.key}`;
      } else if (f.type === 'enum') {
        const options = f.options.map((o) => `<option ${o === value ? 'selected' : ''}>${o}</option>`).join('');
        wrap.innerHTML = `${f.key}<select data-field="${f.key}" data-type="enum">${options}</select>`;
      } else if (f.type === 'nanoseconds-duration') {
        const minutes = value != null ? Math.round((value / NANOS_PER_MINUTE) * 100) / 100 : Math.round((f.default / NANOS_PER_MINUTE) * 100) / 100;
        const minMin = Math.round((f.min / NANOS_PER_MINUTE) * 100) / 100;
        const maxMin = Math.round((f.max / NANOS_PER_MINUTE) * 100) / 100;
        wrap.innerHTML = `${f.key} (minutes, ${minMin}–${maxMin})
          <input type="number" step="0.1" min="${minMin}" max="${maxMin}" value="${minutes}" data-field="${f.key}" data-type="nanoseconds-duration" />`;
      } else {
        // float
        wrap.innerHTML = `${f.key} (${f.min}–${f.max})
          <input type="number" step="0.05" min="${f.min}" max="${f.max}" value="${value != null ? value : f.default}" data-field="${f.key}" data-type="float" />`;
      }
      container.appendChild(wrap);
    });
  }

  function collectGameplayFields() {
    const out = {};
    document.querySelectorAll('#gameplayFieldsContainer [data-field]').forEach((el) => {
      const key = el.dataset.field;
      const type = el.dataset.type;
      if (type === 'bool') out[key] = el.checked;
      else if (type === 'enum') out[key] = el.value;
      else if (type === 'nanoseconds-duration') out[key] = Math.round(parseFloat(el.value || '0') * NANOS_PER_MINUTE);
      else out[key] = parseFloat(el.value || '0');
    });
    return out;
  }

  function renderUserGroups(groups) {
    const container = document.getElementById('userGroupsContainer');
    container.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'group-row';
    header.style.color = 'var(--text-dim)';
    header.style.fontSize = '11px';
    header.innerHTML = `<div>Name</div><div>Password</div><div class="small-check">Kick/Ban</div>
      <div class="small-check">Inventories</div><div class="small-check">Edit base</div>
      <div class="small-check">Extend base</div><div>Reserved</div><div></div>`;
    container.appendChild(header);

    (groups || []).forEach((g, idx) => {
      const row = document.createElement('div');
      row.className = 'group-row';
      row.dataset.idx = idx;
      row.innerHTML = `
        <input type="text" data-g="name" value="${g.name || ''}" />
        <input type="text" data-g="password" value="${g.password || ''}" />
        <input type="checkbox" data-g="canKickBan" ${g.canKickBan ? 'checked' : ''} />
        <input type="checkbox" data-g="canAccessInventories" ${g.canAccessInventories ? 'checked' : ''} />
        <input type="checkbox" data-g="canEditBase" ${g.canEditBase ? 'checked' : ''} />
        <input type="checkbox" data-g="canExtendBase" ${g.canExtendBase ? 'checked' : ''} />
        <input type="number" min="0" data-g="reservedSlots" value="${g.reservedSlots || 0}" />
        <button class="btn btn-danger" data-remove-group>✕</button>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll('[data-remove-group]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.target.closest('.group-row').remove();
      });
    });
  }

  function collectUserGroups() {
    const rows = document.querySelectorAll('#userGroupsContainer .group-row[data-idx]');
    return Array.from(rows).map((row) => ({
      name: row.querySelector('[data-g="name"]').value,
      password: row.querySelector('[data-g="password"]').value,
      canKickBan: row.querySelector('[data-g="canKickBan"]').checked,
      canAccessInventories: row.querySelector('[data-g="canAccessInventories"]').checked,
      canEditBase: row.querySelector('[data-g="canEditBase"]').checked,
      canExtendBase: row.querySelector('[data-g="canExtendBase"]').checked,
      reservedSlots: Number(row.querySelector('[data-g="reservedSlots"]').value || 0)
    }));
  }

  document.getElementById('btnAddGroup').addEventListener('click', () => {
    const groups = collectUserGroups();
    groups.push({ name: 'NewGroup', password: '', canKickBan: false, canAccessInventories: true, canEditBase: false, canExtendBase: false, reservedSlots: 0 });
    renderUserGroups(groups);
  });

  function populateServerFields(cfg) {
    document.getElementById('cfgName').value = cfg.name || '';
    document.getElementById('cfgIp').value = cfg.ip || '0.0.0.0';
    document.getElementById('cfgQueryPort').value = cfg.queryPort || 15637;
    document.getElementById('cfgSlotCount').value = cfg.slotCount || 16;
    document.getElementById('cfgSaveDirectory').value = cfg.saveDirectory || './savegame';
    document.getElementById('cfgLogDirectory').value = cfg.logDirectory || './logs';
    document.getElementById('cfgVoiceChatMode').value = cfg.voiceChatMode || 'Proximity';
    document.getElementById('cfgEnableVoiceChat').checked = !!cfg.enableVoiceChat;
    document.getElementById('cfgEnableTextChat').checked = !!cfg.enableTextChat;
    document.getElementById('cfgGameSettingsPreset').value = cfg.gameSettingsPreset || 'Default';
  }

  function collectServerFields(base) {
    return {
      ...base,
      name: document.getElementById('cfgName').value,
      ip: document.getElementById('cfgIp').value,
      queryPort: Number(document.getElementById('cfgQueryPort').value),
      slotCount: Number(document.getElementById('cfgSlotCount').value),
      saveDirectory: document.getElementById('cfgSaveDirectory').value,
      logDirectory: document.getElementById('cfgLogDirectory').value,
      voiceChatMode: document.getElementById('cfgVoiceChatMode').value,
      enableVoiceChat: document.getElementById('cfgEnableVoiceChat').checked,
      enableTextChat: document.getElementById('cfgEnableTextChat').checked,
      gameSettingsPreset: document.getElementById('cfgGameSettingsPreset').value
    };
  }

  function loadConfigIntoForms(cfg) {
    currentConfig = cfg;
    populateServerFields(cfg);
    renderGameplayFields(cfg.gameSettings);
    renderUserGroups(cfg.userGroups);
    document.getElementById('bannedAccountsRaw').value = (cfg.bannedAccounts || []).join('\n');
    document.getElementById('rawJsonEditor').value = JSON.stringify(cfg, null, 2);
  }

  async function loadConfig() {
    const schema = await api('/api/config/schema');
    gameSettingsFields = schema.gameSettingsFields;
    const result = await api('/api/config');
    document.getElementById('configMissingBanner').hidden = result.exists;
    document.getElementById('infoConfigExists').textContent = result.exists ? 'Found' : 'Not generated yet';
    loadConfigIntoForms(result.config);
  }

  document.getElementById('btnGenerateDefault').addEventListener('click', async () => {
    try {
      await api('/api/config/generate-default', { method: 'POST' });
      await loadConfig();
      alert('Default template written. Edit it here, then Save, before starting the server for real.');
    } catch (err) { alert(err.message); }
  });

  document.getElementById('btnReloadConfig').addEventListener('click', loadConfig);

  document.getElementById('btnSaveConfig').addEventListener('click', async () => {
    // Whichever sub-tab is active decides the source of truth for that
    // section; Raw JSON, if it was the last thing edited, takes priority
    // for the whole object by being merged last.
    let cfg = collectServerFields(currentConfig || {});
    cfg.gameSettings = collectGameplayFields();
    cfg.userGroups = collectUserGroups();
    cfg.bannedAccounts = document.getElementById('bannedAccountsRaw').value
      .split('\n').map((s) => s.trim()).filter(Boolean);

    const rawTextArea = document.getElementById('rawJsonEditor');
    const activeSubtab = document.querySelector('.config-subtab.active').dataset.subtab;
    if (activeSubtab === 'raw') {
      try {
        cfg = JSON.parse(rawTextArea.value);
      } catch (err) {
        alert('Raw JSON is not valid: ' + err.message);
        return;
      }
    } else {
      rawTextArea.value = JSON.stringify(cfg, null, 2);
    }

    try {
      await api('/api/config', { method: 'POST', body: JSON.stringify(cfg) });
      document.getElementById('configSaveMsg').textContent = 'Saved at ' + new Date().toLocaleTimeString();
      currentConfig = cfg;
      document.getElementById('configMissingBanner').hidden = true;
      loadQuickInfo();
    } catch (err) {
      alert(err.message);
    }
  });

  async function loadQuickInfo() {
    try {
      const result = await api('/api/config');
      document.getElementById('infoQueryPort').textContent = result.config.queryPort || '—';
      document.getElementById('infoSlots').textContent = result.config.slotCount || '—';
      document.getElementById('infoConfigExists').textContent = result.exists ? 'Found' : 'Not generated yet';
      const qsHint = document.getElementById('qsQueryPortHint');
      if (qsHint) qsHint.textContent = result.config.queryPort || '15637';
    } catch (_) { /* ignore */ }
  }

  // ---------- backups ----------
  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function loadBackups() {
    const backups = await api('/api/backups');
    const body = document.getElementById('backupsTableBody');
    body.innerHTML = '';
    backups.forEach((b) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${b.name}</td>
        <td>${formatBytes(b.sizeBytes)}</td>
        <td>${new Date(b.createdAt).toLocaleString()}</td>
        <td class="btn-row">
          <button class="btn" data-restore="${b.name}">Restore</button>
          <button class="btn btn-danger" data-delete="${b.name}">Delete</button>
        </td>`;
      body.appendChild(tr);
    });
    body.querySelectorAll('[data-restore]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Restore ${btn.dataset.restore}? The server must be stopped, and this overwrites the current save.`)) return;
        try {
          await api(`/api/backups/${encodeURIComponent(btn.dataset.restore)}/restore`, { method: 'POST' });
          alert('Restored.');
        } catch (err) { alert(err.message); }
      });
    });
    body.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Delete backup ${btn.dataset.delete}?`)) return;
        try {
          await api(`/api/backups/${encodeURIComponent(btn.dataset.delete)}`, { method: 'DELETE' });
          loadBackups();
        } catch (err) { alert(err.message); }
      });
    });
  }

  document.getElementById('btnBackupNow').addEventListener('click', async () => {
    try {
      await api('/api/backups', { method: 'POST' });
      loadBackups();
    } catch (err) { alert(err.message); }
  });

  document.getElementById('btnSaveSchedule').addEventListener('click', async () => {
    try {
      await api('/api/backups/schedule', {
        method: 'POST',
        body: JSON.stringify({
          backupsEnabled: document.getElementById('backupEnabled').checked,
          backupIntervalMinutes: Number(document.getElementById('backupInterval').value),
          backupRetentionCount: Number(document.getElementById('backupRetention').value)
        })
      });
      alert('Schedule saved.');
    } catch (err) { alert(err.message); }
  });

  // ---------- logs ----------
  async function loadLogLists() {
    const data = await api('/api/logs');
    const consoleList = document.getElementById('consoleLogList');
    const gameList = document.getElementById('gameLogList');
    consoleList.innerHTML = '';
    gameList.innerHTML = '';

    data.console.forEach((f) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${f.name}</span><span class="meta">${formatBytes(f.sizeBytes)}</span>`;
      li.addEventListener('click', () => viewLog('console', f.name));
      consoleList.appendChild(li);
    });
    data.game.forEach((f) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${f.name}</span><span class="meta">${formatBytes(f.sizeBytes)}</span>`;
      li.addEventListener('click', () => viewLog('game', f.name));
      gameList.appendChild(li);
    });

    if (data.game.length === 0) {
      gameList.innerHTML = '<li class="hint">No game logs yet — logDirectory only fills in once the server has run.</li>';
    }
  }

  async function viewLog(source, name) {
    document.getElementById('logViewerTitle').textContent = `${source === 'console' ? 'Console' : 'Game'} — ${name}`;
    const res = await fetch(`/api/logs/${source}/${encodeURIComponent(name)}`);
    const text = await res.text();
    document.getElementById('logViewerContent').textContent = text;
  }

  // ---------- boot ----------
  async function init() {
    connectWs();
    await loadSettings();
    await refreshStatus();
    await loadSteamCmdStatus();
    await loadConfig();
    await loadQuickInfo();
    setInterval(refreshStatus, 5000);
  }

  init();
})();
