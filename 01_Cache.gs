// ===================== CACHE SERVICE (GZIP + BASE64 + CHUNKS) =====================
/**
 * Sistema de cache con compresion GZIP para datos grandes.
 * Pipeline: JSON -> minify -> gzip -> base64 -> chunk (95KB) -> CacheService
 * Lectura: chunks -> join -> base64 decode -> gunzip -> JSON.parse
 * TTL: 30 minutos (datos de hojas), 2 horas (login)
 */
var CACHE_DURATION = 3600; // V64-PERF: 60 minutos para datos de hojas (era 30 min)
var CACHE_LOGIN = 7200;    // 2 horas para cache de login
var CHUNK_SIZE = 95000;    // 95KB por chunk
var MAX_CHUNKS = 25;       // Maximo chunks permitidos (25 * 95KB = 2.3MB comprimido)
// V64-PERF: Controlar nivel de logging. 0=off, 1=errores, 2=resumen, 3=debug
var LOG_LEVEL = 1;
// V65: Build stamp para verificar deploy
var BUILD_GS = 'V104-20260209';
// V64: WC-excluded BPs — almacenamiento por sesión para exclusión cross-base
var _wcBPsSession = {};
// V65-PERF: Override Logger.log para que sea condicional con LOG_LEVEL
// Esto evita el overhead de 860+ concatenaciones de string cuando LOG_LEVEL < 2
var _origLogFn = Logger.log.bind(Logger);
Logger.log = function(msg) { if (LOG_LEVEL >= 2) _origLogFn(msg); };
// V65: Log incondicional para auditoría crítica (WC, BUILD, errores)
function _auditLog(msg) { _origLogFn(msg); }
// V64-PERF: Helper de logging condicional para reducir overhead
function _log(level, msg) { if (LOG_LEVEL >= level) _origLogFn(msg); }

// V24 SPEED: Simple string hash for password caching
function simpleHash(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

function getCacheKey(baseKey, tipo) {
  return 'CARGO_' + baseKey + '_' + tipo + '_v88';
}

function getFromCache(baseKey, tipo) {
  try {
    var cache = CacheService.getScriptCache();
    var key = getCacheKey(baseKey, tipo);
    
    // Intentar chunk unico (datos pequenos, sin comprimir)
    var cached = cache.get(key);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Intentar multi-chunk comprimido
    var meta = cache.get(key + '_meta');
    if (meta) {
      var metaObj = JSON.parse(meta);
      var chunkKeys = [];
      for (var i = 0; i < metaObj.chunks; i++) chunkKeys.push(key + '_' + i);
      var chunkData = cache.getAll(chunkKeys);
      var allChunks = [];
      for (var i = 0; i < metaObj.chunks; i++) {
        var chunk = chunkData[key + '_' + i];
        if (!chunk) { Logger.log('CACHE MISS: chunk ' + i + ' de ' + key); return null; }
        allChunks.push(chunk);
      }
      var b64 = allChunks.join('');
      if (metaObj.gz) {
        // Decompress: base64 -> blob -> gunzip -> string -> JSON
        var compressed = Utilities.base64Decode(b64);
        var blob = Utilities.newBlob(compressed, 'application/x-gzip');
        var decompressed = Utilities.ungzip(blob);
        return JSON.parse(decompressed.getDataAsString());
      } else {
        return JSON.parse(b64);
      }
    }
  } catch(e) {
    _log('Cache get error (' + baseKey + '/' + tipo + '): ' + e.message);
  }
  return null;
}

function setToCache(baseKey, tipo, data) {
  try {
    var cache = CacheService.getScriptCache();
    var key = getCacheKey(baseKey, tipo);
    var json = JSON.stringify(data);
    
    if (json.length < CHUNK_SIZE) {
      // Dato pequeno: un solo entry sin comprimir
      cache.put(key, json, CACHE_DURATION);
      Logger.log('CACHE SET: ' + key + ' (' + json.length + ' bytes)');
      return;
    }
    
    // Dato grande: comprimir con GZIP + Base64
    var blob = Utilities.newBlob(json, 'application/json');
    var gzipped = Utilities.gzip(blob);
    var b64 = Utilities.base64Encode(gzipped.getBytes());
    
    Logger.log('CACHE COMPRESS: ' + key + ' raw=' + json.length + ' gz+b64=' + b64.length + ' ratio=' + Math.round(b64.length/json.length*100) + '%');
    
    var numChunks = Math.ceil(b64.length / CHUNK_SIZE);
    if (numChunks > MAX_CHUNKS) {
      Logger.log('CACHE SKIP: ' + key + ' aun comprimido excede limite (' + numChunks + ' chunks, ' + b64.length + ' bytes)');
      // FALLBACK: cachear solo stats/KPIs (payload minimo)
      try {
        var statsOnly = { _fallback: true, count: data.length, ts: Date.now() };
        cache.put(key, JSON.stringify(statsOnly), CACHE_DURATION);
        Logger.log('CACHE FALLBACK: ' + key + ' (solo metadata)');
      } catch(fe) {}
      return;
    }
    
    var cacheObj = {};
    cacheObj[key + '_meta'] = JSON.stringify({ chunks: numChunks, len: data.length, gz: true });
    for (var i = 0; i < numChunks; i++) {
      cacheObj[key + '_' + i] = b64.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    }
    cache.putAll(cacheObj, CACHE_DURATION);
    Logger.log('CACHE SET (gz+chunked): ' + key + ' (' + b64.length + ' bytes, ' + numChunks + ' chunks)');
  } catch(e) {
    _log('Cache set error (' + baseKey + '/' + tipo + '): ' + e.message);
  }
}

// V80: Retornar URL del web app para redirect post-logout
function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

function clearAllCache() {
  try {
    // V65: Reset WC session para forzar re-detección
    _wcBPsSession = {};
    var cache = CacheService.getScriptCache();
    var keys = [];
    ['CHILE', 'RAMPA', 'LATAM', 'NAM'].forEach(function(bk) {
      ['base'].forEach(function(tipo) {
        // v3, v4, v5, v6, v54, v58, v65, v72e, v88 keys
        ['_v3', '_v4', '_v5', '_v6', '_v54', '_v58', '_v65', '_v72e', '_v88'].forEach(function(ver) {
          var key = 'CARGO_' + bk + '_' + tipo + ver;
          keys.push(key);
          keys.push(key + '_meta');
          for (var i = 0; i < MAX_CHUNKS; i++) keys.push(key + '_' + i);
        });
        // V65: Limpiar cache de wcBPs por base
        keys.push('CARGO_' + bk + '_wcBPs_v58');
        keys.push('CARGO_' + bk + '_wcBPs_v65');
        keys.push('CARGO_' + bk + '_wcBPs_v72e');
        keys.push('CARGO_' + bk + '_wcBPs_v88');
      });
    });
    // Limpiar TODAS las variantes de cache de dashboard stats
    var filtros = ['TODO', 'CHILE', 'RAMPA', 'LATAM', 'NAM', 'HCC'];
    var sufijos = ['_ADM', '_U_CHILE', '_U_RAMPA', '_U_LATAM', '_U_NAM', '_U_MAESTRO', '_U_X', '_U_ANON'];
    filtros.forEach(function(f) {
      sufijos.forEach(function(s) {
        keys.push('CARGO_DASH_STATS_' + f + s);
        // V58+V65: Limpiar cache de dashboard versiones anteriores
        keys.push('CARGO_DASH_V49_' + f + s);
        keys.push('CARGO_DASH_V54_' + f + s);
        keys.push('CARGO_DASH_V58_' + f + s);
        keys.push('CARGO_DASH_V65_' + f + s);
        keys.push('CARGO_DASH_V69_' + f + s);
      });
      // Limpiar cache de FORECAST RAW por filtro
      keys.push('FORECAST_RAW_' + f);
      // V58+V65: Limpiar TODAS las versiones de cache de forecast
      keys.push('FORECAST_V36_' + f);
      keys.push('FORECAST_V54_' + f);
      keys.push('FORECAST_V58_' + f);
      keys.push('FORECAST_V65_' + f);
      keys.push('FORECAST_V68_' + f);
      keys.push('FORECAST_V72_' + f);
      keys.push('FORECAST_V72e_' + f);
      keys.push('FORECAST_V36_' + f + '_meta');
      keys.push('FORECAST_V54_' + f + '_meta');
      keys.push('FORECAST_V58_' + f + '_meta');
      keys.push('FORECAST_V65_' + f + '_meta');
      keys.push('FORECAST_V68_' + f + '_meta');
      keys.push('FORECAST_V72_' + f + '_meta');
      keys.push('FORECAST_V72e_' + f + '_meta');
      for (var fi = 0; fi < MAX_CHUNKS; fi++) {
        keys.push('FORECAST_V36_' + f + '_' + fi);
        keys.push('FORECAST_V54_' + f + '_' + fi);
        keys.push('FORECAST_V58_' + f + '_' + fi);
        keys.push('FORECAST_V65_' + f + '_' + fi);
        keys.push('FORECAST_V68_' + f + '_' + fi);
        keys.push('FORECAST_V72_' + f + '_' + fi);
        keys.push('FORECAST_V72e_' + f + '_' + fi);
      }
    });
    cache.removeAll(keys);
    // V3: Limpiar index cache para forzar rebuild completo
    var idxKeys = ['GAUTH_IDX_V92_META'];
    for (var ic = 0; ic < 50; ic++) idxKeys.push('GAUTH_IDX_V92_' + ic);
    cache.removeAll(idxKeys);
    
    // V42: También limpiar cache de PASSWORDS y LOGINS
    // Google Apps Script cache no permite listar keys, así que leemos la hoja Contraseñas
    // y también limpiamos keys comunes
    try {
      var ssMaestro = getSpreadsheet('MAESTRO');
      var shPass = ssMaestro.getSheetByName('Contrase\u00f1as') || ssMaestro.getSheetByName('Contrasenas');
      if (shPass && shPass.getLastRow() > 1) {
        var passData = shPass.getDataRange().getValues();
        var passKeys = [];
        for (var pi = 1; pi < passData.length; pi++) {
          var pEmail = (passData[pi][0] || '').toString().trim().toLowerCase();
          if (pEmail) {
            passKeys.push('CUSTPASS_' + pEmail);
            passKeys.push('USERLOGIN_' + pEmail);
          }
        }
        if (passKeys.length > 0) cache.removeAll(passKeys);
        _log('Cache passwords limpiado: ' + passKeys.length + ' keys');
      }
      // Limpiar Admins emails también + V3: Login GAUTH caches
      var shAdmins = ssMaestro.getSheetByName('Admins');
      if (shAdmins) {
        var admData = shAdmins.getDataRange().getValues();
        var admKeys = [];
        for (var ai = 1; ai < admData.length; ai++) {
          var aEmail = (admData[ai][1] || '').toString().trim().toLowerCase();
          if (aEmail) {
            admKeys.push('CUSTPASS_' + aEmail);
            admKeys.push('USERLOGIN_' + aEmail);
            admKeys.push('JEFE_V36_' + aEmail);
            admKeys.push('GAUTH_' + aEmail);
            admKeys.push('GAUTH_V3_' + aEmail);
            admKeys.push('JEFE_V92_' + aEmail);
          }
          // V3: Limpiar CAPACITY login caches también
          var capEmail = (admData[ai][11] || '').toString().trim().toLowerCase();
          if (capEmail && capEmail.indexOf('@') > 0) {
            admKeys.push('GAUTH_' + capEmail);
            admKeys.push('GAUTH_V3_' + capEmail);
            admKeys.push('JEFE_V92_' + capEmail);
          }
        }
        if (admKeys.length > 0) cache.removeAll(admKeys);
        _log('Cache admins limpiado: ' + admKeys.length + ' keys');
      }
      // V42: Limpiar por todas las bases también
      var allBases = ['CHILE', 'RAMPA', 'LATAM', 'NAM'];
      allBases.forEach(function(bk2) {
        try {
          var ss2 = getSpreadsheet(bk2);
          var sh2 = ss2.getSheetByName(TABS[bk2].base);
          if (sh2) {
            var bData = sh2.getDataRange().getDisplayValues();
            var cfg2 = CONFIG_BASE[bk2];
            var bKeys = [];
            for (var bi = 1; bi < bData.length; bi++) {
              var bEmail = (bData[bi][cfg2.correo] || '').toString().trim().toLowerCase();
              if (bEmail) {
                bKeys.push('CUSTPASS_' + bEmail);
                bKeys.push('USERLOGIN_' + bEmail);
                bKeys.push('JEFE_V36_' + bEmail);
                bKeys.push('GAUTH_' + bEmail);
                bKeys.push('GAUTH_V3_' + bEmail);
                bKeys.push('JEFE_V92_' + bEmail);
              }
            }
            if (bKeys.length > 0) cache.removeAll(bKeys);
            _log('Cache ' + bk2 + ' limpiado: ' + bKeys.length + ' keys');
          }
        } catch(e2) {}
      });
    } catch(e) { Logger.log('Error limpiando cache passwords: ' + e.message); }
    
    _auditLog('[V65] Cache limpiado completamente (v3-v65, base+plan+planMap+dashStats+forecastRaw+passwords+logins+wcBPs). BUILD=' + BUILD_GS);
    return { success: true, build: BUILD_GS };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

/**
 * V43: Limpia SOLO cache de datos (equipos, forecast, dashboard).
 * NO toca cache de passwords/logins. Seguro para ejecutar sin perder sesiones.
 * Usar cuando quieres refrescar datos sin afectar autenticación.
 */
function clearDataCacheOnly() {
  try {
    // V65: Reset WC session
    _wcBPsSession = {};
    var cache = CacheService.getScriptCache();
    var keys = [];
    // 1. Cache de hojas BASE
    ['CHILE', 'RAMPA', 'LATAM', 'NAM'].forEach(function(bk) {
      ['base'].forEach(function(tipo) {
        ['_v3', '_v4', '_v5', '_v6', '_v54', '_v58', '_v65', '_v72e', '_v88'].forEach(function(ver) {
          var key = 'CARGO_' + bk + '_' + tipo + ver;
          keys.push(key);
          keys.push(key + '_meta');
          for (var i = 0; i < MAX_CHUNKS; i++) keys.push(key + '_' + i);
        });
        // V65: wcBPs cache
        keys.push('CARGO_' + bk + '_wcBPs_v58');
        keys.push('CARGO_' + bk + '_wcBPs_v65');
        keys.push('CARGO_' + bk + '_wcBPs_v72e');
        keys.push('CARGO_' + bk + '_wcBPs_v88');
      });
    });
    // 2. Cache de dashboard stats
    var filtros = ['TODO', 'CHILE', 'RAMPA', 'LATAM', 'NAM', 'HCC'];
    var sufijos = ['_ADM', '_U_CHILE', '_U_RAMPA', '_U_LATAM', '_U_NAM', '_U_MAESTRO', '_U_X', '_U_ANON'];
    filtros.forEach(function(f) {
      sufijos.forEach(function(s) {
        keys.push('CARGO_DASH_STATS_' + f + s);
      });
      keys.push('FORECAST_RAW_' + f);
      // V58+V65: Clean old forecast caches
      keys.push('FORECAST_V36_' + f);
      keys.push('FORECAST_V54_' + f);
      keys.push('FORECAST_V58_' + f);
      keys.push('FORECAST_V65_' + f);
      keys.push('FORECAST_V68_' + f);
      keys.push('FORECAST_V72_' + f);
      keys.push('FORECAST_V72e_' + f);
      keys.push('FORECAST_V36_' + f + '_meta');
      keys.push('FORECAST_V54_' + f + '_meta');
      keys.push('FORECAST_V58_' + f + '_meta');
      keys.push('FORECAST_V65_' + f + '_meta');
      keys.push('FORECAST_V68_' + f + '_meta');
      keys.push('FORECAST_V72_' + f + '_meta');
      keys.push('FORECAST_V72e_' + f + '_meta');
      for (var fi = 0; fi < MAX_CHUNKS; fi++) {
        keys.push('FORECAST_V36_' + f + '_' + fi);
        keys.push('FORECAST_V54_' + f + '_' + fi);
        keys.push('FORECAST_V58_' + f + '_' + fi);
        keys.push('FORECAST_V65_' + f + '_' + fi);
        keys.push('FORECAST_V68_' + f + '_' + fi);
        keys.push('FORECAST_V72_' + f + '_' + fi);
        keys.push('FORECAST_V72e_' + f + '_' + fi);
      }
    });
    // 3. Cache de Mi Equipo (por email) — V48: incluir variantes con fuente
    // No podemos listar keys, pero limpiamos los comunes
    var ssMaestro = getSpreadsheet('MAESTRO');
    var shAdmins = ssMaestro.getSheetByName('Admins');
    if (shAdmins) {
      var admData = shAdmins.getDataRange().getValues();
      for (var ai = 1; ai < admData.length; ai++) {
        var aEmail = (admData[ai][1] || '').toString().trim().toLowerCase();
        if (aEmail) {
          var aKey = aEmail.replace(/[^a-z0-9]/g, '_');
          keys.push('MIEQUIPO_' + aKey);
          keys.push('MIEQUIPO_PHH_' + aKey);
          keys.push('MIEQUIPO_RAMPA_' + aKey);
          keys.push('MIEQUIPO_CONSOLIDADO_' + aKey);
        }
      }
    }
    var shJefes = ssMaestro.getSheetByName('Jefes');
    if (shJefes) {
      var jData = shJefes.getDataRange().getValues();
      for (var ji = 1; ji < jData.length; ji++) {
        var jEmail = (jData[ji][0] || '').toString().trim().toLowerCase(); // V88: col A = Mail
        if (jEmail) {
          var jKey = jEmail.replace(/[^a-z0-9]/g, '_');
          keys.push('MIEQUIPO_' + jKey);
          keys.push('MIEQUIPO_PHH_' + jKey);
          keys.push('MIEQUIPO_RAMPA_' + jKey);
          keys.push('MIEQUIPO_CONSOLIDADO_' + jKey);
        }
      }
    }
    cache.removeAll(keys);
    _auditLog('[V65] clearDataCacheOnly: ' + keys.length + ' keys limpiadas. BUILD=' + BUILD_GS);
    return { success: true, keysLimpiadas: keys.length, build: BUILD_GS, mensaje: 'Cache de datos limpiado (V65). wcBPsSession reseteado.' };
  } catch(e) {
    _log('[V3] clearDataCacheOnly ERROR: ' + e.message);
    return { success: false, error: e.message };
  }
}


/**
 * Precarga TODAS las bases en cache. Llamar después del login.
 * Retorna estado de cada base para diagnóstico.
 */
function preloadAllBases() {
  var results = {};
  var inicio = new Date().getTime();
  ['CHILE', 'LATAM', 'RAMPA', 'NAM'].forEach(function(b) {
    try {
      var t0 = new Date().getTime();
      var data = leerHoja(b, 'base');
      results[b + '_base'] = { ok: true, count: data.length, ms: new Date().getTime() - t0 };
    } catch(e) {
      results[b + '_base'] = { ok: false, error: e.message };
    }
    // BASE-ONLY: No se precarga PLAN
  });
  results.totalMs = new Date().getTime() - inicio;
  Logger.log('preloadAllBases: ' + JSON.stringify(results));
  return results;
}
