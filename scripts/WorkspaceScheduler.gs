/**
 * Install in a standalone Apps Script project owned by the recruiting Workspace account.
 * Set secrets in Project Settings > Script properties; never put them in this source.
 * HIRING_SITE_URL: exact HTTPS origin, without a path.
 * HIRING_SCHEDULER_SECRET: same secret as Sites HUB_SCHEDULER_SECRET.
 * Optional SITE_SERVICE_TOKEN: private Sites bypass token (may expire).
 * Optional HIRING_BATCH_LIMIT: 1..10 (default 10).
 */
function workspaceSchedulerConfig_() {
  var properties = PropertiesService.getScriptProperties();
  var origin = properties.getProperty('HIRING_SITE_URL') || '';
  if (!/^https:\/\/[a-zA-Z0-9.-]+(?::443)?\/?$/.test(origin)) throw new Error('Set HIRING_SITE_URL to the exact HTTPS site origin.');
  var secret = properties.getProperty('HIRING_SCHEDULER_SECRET') || '';
  if (secret.length < 32 || /[\r\n]/.test(secret)) throw new Error('Set HIRING_SCHEDULER_SECRET to the site scheduler secret.');
  var token = properties.getProperty('SITE_SERVICE_TOKEN') || '';
  if (/[\r\n]/.test(token)) throw new Error('Invalid private Sites service token configuration.');
  var limit = Number(properties.getProperty('HIRING_BATCH_LIMIT') || '10');
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('HIRING_BATCH_LIMIT must be 1..10.');
  return { origin: origin.replace(/\/$/, ''), secret: secret, token: token, limit: limit };
}

/** Run manually once after configuring properties and confirming the site's processor is ready. */
function installWorkspaceScheduler() {
  workspaceSchedulerConfig_();
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'runHiringQueue') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('runHiringQueue').timeBased().everyMinutes(1).create();
}

/** The D1 queue owns task leases/retries; this trigger only wakes the authenticated processor. */
function runHiringQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var config = workspaceSchedulerConfig_();
    var headers = { Authorization: 'Bearer ' + config.secret };
    if (config.token) headers['OAI-Sites-Authorization'] = 'Bearer ' + config.token;
    var response = UrlFetchApp.fetch(config.origin + '/api/hub/process', {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify({ limit: config.limit }), followRedirects: false, muteHttpExceptions: true, timeoutSeconds: 50
    });
    var status = response.getResponseCode();
    // Never log response bodies, candidate data, tokens, or request headers.
    if (status < 200 || status >= 300) throw new Error('Hiring queue processor HTTP ' + status + '. Check server task status.');
    var properties = PropertiesService.getScriptProperties();
    properties.setProperty('HIRING_LAST_WAKEUP_AT', new Date().toISOString());
    var text = response.getContentText();
    if (text.length > 16384) throw new Error('Hiring processor returned an invalid response.');
    var data;
    try { data = JSON.parse(text).data; } catch (error) { throw new Error('Hiring processor returned an invalid response.'); }
    if (!data || data.configured !== true) throw new Error('Google Workspace is disconnected. Check the hiring hub.');
    if (data.healthy === false || data.failed > 0 || data.uncertain > 0 || data.error) throw new Error('Hiring integration tasks need attention. Review the hub delivery and sync health.');
    properties.setProperty('HIRING_LAST_SUCCESS_AT', new Date().toISOString());
    properties.setProperty('HIRING_LAST_ERROR', '');
  } catch (error) {
    // All thrown messages here are controlled summaries, never provider response bodies.
    PropertiesService.getScriptProperties().setProperty('HIRING_LAST_ERROR', String(error.message || 'Hiring queue wakeup failed.').slice(0, 250));
    PropertiesService.getScriptProperties().setProperty('HIRING_LAST_ERROR_AT', new Date().toISOString());
    throw error;
  } finally { lock.releaseLock(); }
}

function uninstallWorkspaceScheduler() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'runHiringQueue') ScriptApp.deleteTrigger(trigger);
  });
}
